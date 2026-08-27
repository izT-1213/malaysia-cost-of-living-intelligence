from datetime import date

import polars as pl
import pytest

from pipeline.ingestion.pricecatcher import monthly_url
from pipeline.metrics.price import median_prices, percentage_change, robust_z_scores
from pipeline.quality.pricecatcher import validate_observations
from pipeline.storage.supabase import load_item_area_summary
from pipeline.summaries.pricecatcher import summarize_item_area
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


def test_robust_z_score_adds_anomaly_signal():
    frame = pl.DataFrame({"price": [10.0, 10.0, 100.0]})
    result = robust_z_scores(frame)
    assert result["robust_z_score"].to_list()[-1] > 10


def test_pricecatcher_monthly_url_is_deterministic():
    assert monthly_url(date(2026, 8, 20)) == (
        "https://storage.data.gov.my/pricecatcher/pricecatcher_2026-08.parquet"
    )


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


def test_month_and_source_hash_helpers_are_deterministic():
    assert previous_month(date(2026, 1, 15)) == date(2025, 12, 1)
    assert combined_source_hash(["b", "a"]) == combined_source_hash(["a", "b"])
