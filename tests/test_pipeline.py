from datetime import date

import httpx
import polars as pl
import pytest

from pipeline.ingestion.pricecatcher import download_latest_available_snapshot, monthly_url
from pipeline.insights import (
    _is_daily_quota_error,
    _parse_gemini_bundle,
    build_daily_insight_payload,
    metric_snapshot_id,
)
from pipeline.metrics.price import median_prices, percentage_change, robust_z_scores
from pipeline.quality.pricecatcher import suspicious_observations, validate_observations
from pipeline.storage.supabase import load_daily_basket_summary, load_item_area_summary
from pipeline.summaries.pricecatcher import summarize_item_area, summarize_item_premise, summarize_latest_premise
from pipeline.summaries.windows import combined_source_hash, previous_month, recent_window
from pipeline.transforms.enrich import enrich_observations
from pipeline.transforms.pricecatcher import normalize_columns


def test_normalize_aliases_and_casts_types():
    raw = pl.DataFrame({"observation_date": ["2026-08-19"], "product_name": ["Rice"], "harga": [12]})
    result = normalize_columns(raw)
    assert result.select("date", "item_name", "price").row(0) == (date(2026, 8, 19), "Rice", 12.0)
    assert validate_observations(result) == []


def test_normalize_official_pricecatcher_columns():
    raw = pl.DataFrame(
        {"date": [date(2026, 8, 19)], "premise_code": [2], "item_code": [1], "price": [11.0]}
    )
    result = normalize_columns(raw)
    assert result.select("date", "item_id", "price").row(0) == (date(2026, 8, 19), 1, 11.0)


def test_normalization_rejects_missing_required_column():
    with pytest.raises(ValueError, match="item_name"):
        normalize_columns(pl.DataFrame({"date": ["2026-08-19"], "price": [1]}))


def test_median_price_is_deterministic():
    frame = pl.DataFrame({"item_name": ["Rice", "Rice", "Eggs"], "price": [10.0, 14.0, 5.0]})
    result = median_prices(frame).sort("item_name")
    assert result["median_price"].to_list() == [5.0, 12.0]


def test_percentage_change_handles_zero_baseline():
    assert percentage_change(110, 100) == pytest.approx(10)
    assert percentage_change(1, 0) is None


def test_quality_rejects_non_positive_prices():
    frame = pl.DataFrame({"date": [date(2026, 8, 19)], "item_name": ["Rice"], "price": [0.0]})
    assert "price contains non-positive values" in validate_observations(frame)


def test_quality_flags_invalid_duplicate_and_extreme_rows_without_filtering_them():
    frame = pl.DataFrame({
        "date": [date(2026, 8, 19), date(2026, 8, 19), date(2026, 8, 19), date(2026, 8, 19)],
        "item_id": [1, 1, 2, 3], "premise_id": [2, 2, 2, 2],
        "price": [10.0, 10.0, 0.0, 1000.0],
    })
    flagged = suspicious_observations(frame)
    assert flagged.height == 4
    assert flagged.filter(pl.col("invalid_price")).height == 1
    assert flagged.filter(pl.col("duplicate_record")).height == 2


def test_gemini_bundle_parser_accepts_fenced_state_list():
    result = _parse_gemini_bundle(
        '```json\n{"general":"hello","states":[{"state":"Johor","insight":"steady"}]}\n```'
    )
    assert result == {"general": "hello", "states": {"Johor": "steady"}}


def test_gemini_quota_errors_are_not_classified_as_transient():
    request = httpx.Request("POST", "https://example.test")
    response = httpx.Response(
        429,
        request=request,
        json={"error": {"status": "RESOURCE_EXHAUSTED", "message": "daily quota exceeded"}},
    )
    assert _is_daily_quota_error(response)


def test_robust_z_score_adds_anomaly_signal():
    frame = pl.DataFrame({"price": [10.0, 10.0, 100.0]})
    result = robust_z_scores(frame)
    assert result["robust_z_score"].to_list()[-1] > 10


def test_pricecatcher_monthly_url_is_deterministic():
    assert monthly_url(date(2026, 8, 20)) == (
        "https://storage.data.gov.my/pricecatcher/pricecatcher_2026-08.parquet"
    )


def test_latest_available_snapshot_falls_back_to_previous_month(tmp_path, monkeypatch):
    requested = date(2026, 9, 1)
    calls = []

    def fake_download(raw_dir, value, timeout_seconds):
        calls.append(value)
        if value.month == 9:
            request = httpx.Request("GET", "https://example.test/ september")
            response = httpx.Response(404, request=request)
            raise httpx.HTTPStatusError("not published", request=request, response=response)
        return object()

    monkeypatch.setattr("pipeline.ingestion.pricecatcher.download_monthly_snapshot", fake_download)
    result = download_latest_available_snapshot(tmp_path, requested)

    assert result is not None
    assert calls == [date(2026, 9, 1), date(2026, 8, 1)]


def test_enrich_observations_joins_official_lookup_fields():
    observations = pl.DataFrame({
        "date": [date(2026, 8, 19)], "item_id": [1], "premise_id": [2], "price": [11.0]
    })
    items = pl.DataFrame({"item_code": [1], "item": ["Rice"], "unit": ["kg"]})
    premises = pl.DataFrame({"premise_code": [2], "premise": ["Market"], "state": ["Perak"]})
    result = enrich_observations(observations, items, premises)
    assert result.select("item_name", "premise_name", "state").row(0) == ("Rice", "Market", "Perak")


def test_enrich_observations_canonicalizes_reviewed_geographies():
    observations = pl.DataFrame({
        "date": [date(2026, 8, 19)] * 5,
        "item_id": [1] * 5,
        "premise_id": [1, 2, 3, 4, 5],
        "price": [1.0] * 5,
    })
    items = pl.DataFrame({"item_code": [1], "item": ["Rice"]})
    premises = pl.DataFrame({
        "premise_code": [1, 2, 3, 4, 5],
        "premise": ["A", "B", "C", "D", "E"],
        "state": ["Selangor", "Selangor", "W.P. Putrajaya", "Sarawak", "W.P. Putrajaya"],
        "district": ["Petaling Jaya", "Rawang", "Cyberjaya", "Sibujaya", "Wp Putrajaya"],
    })
    result = enrich_observations(observations, items, premises).sort("premise_id")
    assert result.select("source_state", "source_district", "state", "district").rows() == [
        ("Selangor", "Petaling Jaya", "Selangor", "Petaling"),
        ("Selangor", "Rawang", "Selangor", "Gombak"),
        ("W.P. Putrajaya", "Cyberjaya", "Selangor", "Sepang"),
        ("Sarawak", "Sibujaya", "Sarawak", "Sibu"),
        ("W.P. Putrajaya", "Wp Putrajaya", "W.P. Putrajaya", "Putrajaya"),
    ]


def test_daily_summary_creates_state_and_district_rows():
    frame = pl.DataFrame({
        "date": [date(2026, 8, 19)] * 3,
        "item_id": [115, 115, 115],
        "premise_id": [2254, 2280, 2311],
        "price": [12.50, 13.00, 12.80],
        "state": ["Selangor"] * 3,
        "district": ["Petaling"] * 3,
    })
    result = summarize_item_area(frame).sort(["area_level"])
    assert result.select("area_level").to_series().to_list() == ["district", "state"]
    district = result.filter(pl.col("area_level") == "district").row(0, named=True)
    assert (district["min_price"], district["median_price"], district["max_price"]) == (12.5, 12.8, 13.0)
    assert (district["min_premise_code"], district["max_premise_code"]) == (2254, 2280)


def test_monthly_summary_uses_month_start_and_deterministic_ties():
    frame = pl.DataFrame({
        "date": [date(2026, 8, 1), date(2026, 8, 20), date(2026, 8, 20)],
        "item_id": [115, 115, 115],
        "premise_id": [2280, 2254, 2311],
        "price": [12.5, 12.5, 14.0],
        "state": ["Selangor"] * 3,
        "district": ["Petaling"] * 3,
    })
    result = summarize_item_area(frame, period="monthly")
    district = result.filter(pl.col("area_level") == "district").row(0, named=True)
    assert district["metric_month"] == date(2026, 8, 1)
    assert district["min_premise_code"] == 2254


def test_premise_summary_keeps_each_premise_and_item_separate():
    frame = pl.DataFrame({
        "date": [date(2026, 8, 19)] * 3,
        "item_id": [115, 115, 116],
        "premise_id": [2254, 2254, 2254],
        "price": [12.0, 14.0, 5.0],
    })
    result = summarize_item_premise(frame)
    assert result.select("premise_code", "item_code", "median_price").rows() == [(2254, 115, 13.0), (2254, 116, 5.0)]


def test_latest_premise_keeps_latest_observation_and_age():
    frame = pl.DataFrame({
        "date": [date(2026, 8, 1), date(2026, 8, 20), date(2026, 8, 20), date(2026, 7, 20)],
        "item_id": [115, 115, 115, 116], "premise_id": [2254, 2254, 2254, 2254],
        "price": [12.0, 14.0, 16.0, 5.0],
    })
    result = summarize_latest_premise(frame, date(2026, 8, 22)).sort("item_code")
    assert result.select("item_code", "price", "observed_date", "price_age_days").rows() == [
        (115, 15.0, date(2026, 8, 20), 2), (116, 5.0, date(2026, 7, 20), 33)
    ]


class _FakeTable:
    def __init__(self):
        self.rows = None
        self.conflict = None

    def upsert(self, rows, on_conflict):
        self.rows = rows
        self.conflict = on_conflict
        return self

    def execute(self):
        return None


class _FakeClient:
    def __init__(self):
        self.table_instance = _FakeTable()

    def table(self, _table):
        return self.table_instance


def test_summary_loader_adds_source_hash_and_uses_composite_conflict():
    frame = pl.DataFrame({
        "metric_date": [date(2026, 8, 19)],
        "area_level": ["district"],
        "state": ["Selangor"],
        "district": ["Petaling"],
        "item_code": [115],
        "min_price": [12.5],
        "median_price": [12.8],
        "max_price": [13.0],
        "min_premise_code": [2254],
        "max_premise_code": [2280],
    })
    client = _FakeClient()
    assert load_item_area_summary(
        client, frame, "daily_item_area_summary", "abc123", batch_size=10
    ) == 1
    assert client.table_instance.conflict == "metric_date,state,district,item_code"
    assert client.table_instance.rows[0]["source_snapshot_sha256"] == "abc123"


def test_canonical_basket_loader_uses_metric_date_and_state_conflict():
    client = _FakeClient()
    assert load_daily_basket_summary(
        client,
        date(2026, 8, 19),
        [{
            "state": "Selangor",
            "basket_median": 89.03,
            "component_prices": {"Rice": 26.0},
            "reference_basket_items_observed": 10,
            "reference_basket_items_total": 10,
            "reference_basket_days_observed": 7,
        }],
        89.03,
        "abc123",
        batch_size=10,
        snapshot_id="snapshot-1",
    ) == 1
    assert client.table_instance.conflict == "metric_date,state"
    assert client.table_instance.rows[0]["basket_median"] == 89.03
    assert client.table_instance.rows[0]["cross_state_reference"] == 89.03
    assert client.table_instance.rows[0]["source_snapshot_sha256"] == "abc123"
    assert client.table_instance.rows[0]["metric_snapshot_id"] == "snapshot-1"


def test_recent_window_includes_exact_calendar_days():
    frame = pl.DataFrame({
        "date": [date(2026, 7, 15), date(2026, 7, 17), date(2026, 8, 15)],
        "item_id": [1, 1, 1],
        "premise_id": [2, 2, 2],
        "price": [1.0, 2.0, 3.0],
        "state": ["Selangor"] * 3,
        "district": ["Petaling"] * 3,
    })
    assert recent_window(frame, date(2026, 8, 15), days=30)["date"].to_list() == [
        date(2026, 7, 17), date(2026, 8, 15)
    ]


def test_cleanup_retention_cutoff_is_inclusive():
    as_of = date(2026, 9, 2)
    assert as_of - __import__("datetime").timedelta(days=14 - 1) == date(2026, 8, 20)


def test_month_and_source_hash_helpers_are_deterministic():
    assert previous_month(date(2026, 1, 15)) == date(2025, 12, 1)
    assert combined_source_hash(["b", "a"]) == combined_source_hash(["a", "b"])


def test_daily_insight_basket_uses_shared_window_and_median_reference():
    item_lookup = pl.DataFrame({
        "item_code": list(range(1, 11)),
        "item": [
            "BERAS PREMIUM", "AYAM BERSIH", "TELUR AYAM GRED A", "MINYAK MASAK",
            "TEPUNG GANDUM", "BAWANG BESAR", "KENTANG", "KUBIS BULAT",
            "TOMATO", "KANGKUNG",
        ],
        "unit": ["10 kg", "1kg", "30 biji", "1kg", "1kg", "1kg", "1kg", "1kg", "1kg", "1kg"],
        "item_category": [
            "BERAS", "AYAM", "TELUR", "MINYAK DAN LEMAK", "TEPUNG", "BAWANG",
            "UBI KENTANG", "SAYUR-SAYURAN", "SAYUR-SAYURAN", "SAYUR-SAYURAN",
        ],
    })
    rows = []
    state_values = {"Johor": 1.0, "Kedah": 2.0, "Perak": 5.0}
    for day in range(1, 9):
        for state, value in state_values.items():
            for item_code in range(1, 11):
                rows.append({
                    "metric_date": date(2026, 8, day),
                    "area_level": "state",
                    "state": state,
                    "district": "",
                    "item_code": item_code,
                    "median_price": value if day > 1 else value + 100,
                })
    summary = pl.DataFrame(rows)

    payload = build_daily_insight_payload(summary, date(2026, 8, 8), item_lookup)

    assert payload["reference_basket"]["period"] == "7 calendar days ending 2026-08-08 (7 observed days)"
    assert payload["reference_basket"]["complete_states"] == 3
    assert payload["reference_basket"]["basket_median_reference"] == 20.0
    assert payload["reference_basket"]["lowest"]["state"] == "Johor"
    assert payload["reference_basket"]["highest"]["state"] == "Perak"
    assert payload["metric_contract"]["observed_day_count"] == 7
    assert payload["metric_contract"]["complete_state_count"] == 3
    assert payload["metric_snapshot_id"] == metric_snapshot_id(payload["metric_contract"])
