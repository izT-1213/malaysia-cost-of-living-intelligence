"""Quality checks for normalized price observations."""

from __future__ import annotations

import polars as pl


def validate_observations(frame: pl.DataFrame) -> list[str]:
    """Return human-readable validation errors; an empty list means valid."""
    errors: list[str] = []
    required = {"date", "item_name", "price"}
    missing = required - set(frame.columns)
    if missing:
        errors.append(f"missing columns: {', '.join(sorted(missing))}")
        return errors
    if frame.is_empty():
        errors.append("frame is empty")
    if frame.get_column("date").null_count():
        errors.append("date contains nulls")
    if frame.get_column("item_name").null_count():
        errors.append("item_name contains nulls")
    if frame.get_column("price").null_count():
        errors.append("price contains nulls")
    if frame.filter(pl.col("price") <= 0).height:
        errors.append("price contains non-positive values")
    return errors


def suspicious_observations(frame: pl.DataFrame, z_threshold: float = 6.0) -> pl.DataFrame:
    """Flag suspicious rows for review without silently excluding them."""
    required = {"date", "item_id", "premise_id", "price"}
    if missing := required - set(frame.columns):
        raise ValueError(f"Missing quality columns: {', '.join(sorted(missing))}")
    result = frame.with_columns(
        (pl.col("price").is_null() | (pl.col("price") <= 0)).alias("invalid_price"),
        pl.struct(["date", "item_id", "premise_id"]).is_duplicated().alias("duplicate_record"),
    )
    median = result.select(pl.col("price").median()).item()
    mad = result.select((pl.col("price") - median).abs().median()).item()
    scale = 1.4826 * mad
    extreme = (((pl.col("price") - median) / scale).abs() >= z_threshold) if scale and scale > 0 else pl.lit(False)
    return result.with_columns(extreme.alias("extreme_price_flag")).filter(
        pl.col("invalid_price") | pl.col("duplicate_record") | pl.col("extreme_price_flag")
    )
