from datetime import date

import polars as pl
import pytest

from pipeline.metrics.price import median_prices, percentage_change, robust_z_scores
from pipeline.quality.pricecatcher import validate_observations
from pipeline.transforms.pricecatcher import normalize_columns
from pipeline.ingestion.pricecatcher import monthly_url


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
