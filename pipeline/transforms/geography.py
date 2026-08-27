"""Canonicalize administrative geography labels without losing source values."""

from __future__ import annotations

import polars as pl

GEOGRAPHY_OVERRIDES: dict[tuple[str, str], tuple[str, str]] = {
    ("Selangor", "Petaling Jaya"): ("Selangor", "Petaling"),
    ("Selangor", "Rawang"): ("Selangor", "Gombak"),
    ("W.P. Putrajaya", "Cyberjaya"): ("Selangor", "Sepang"),
    ("Sarawak", "Sibujaya"): ("Sarawak", "Sibu"),
    ("W.P. Putrajaya", "Wp Putrajaya"): ("W.P. Putrajaya", "Putrajaya"),
}


def canonicalize_geography(frame: pl.DataFrame) -> pl.DataFrame:
    """Add source geography columns and apply reviewed canonical mappings."""
    result = frame
    for column in ("state", "district"):
        if column not in result.columns:
            result = result.with_columns(pl.lit(None, dtype=pl.String).alias(column))
    result = result.with_columns(
        pl.col("state").alias("source_state"),
        pl.col("district").alias("source_district"),
    )
    state = pl.col("state")
    district = pl.col("district")
    for (source_state, source_district), (target_state, target_district) in GEOGRAPHY_OVERRIDES.items():
        match = (state == source_state) & (district == source_district)
        result = result.with_columns(
            pl.when(match).then(pl.lit(target_state)).otherwise(state).alias("state"),
            pl.when(match).then(pl.lit(target_district)).otherwise(district).alias("district"),
        )
        state = pl.col("state")
        district = pl.col("district")
    return result
