"""Deterministic price metrics; no model calls belong in this module."""

from __future__ import annotations

import polars as pl


def median_prices(frame: pl.DataFrame, by: list[str] | None = None) -> pl.DataFrame:
    """Calculate median observed prices by item and optional dimensions."""
    dimensions = by or ["item_name"]
    return frame.group_by(dimensions).agg(
        pl.col("price").median().alias("median_price"),
        pl.len().alias("observation_count"),
    )


def percentage_change(current: float, comparison: float) -> float | None:
    """Calculate percentage change, returning None when comparison is zero."""
    if comparison == 0:
        return None
    return (current / comparison - 1) * 100


def robust_z_scores(frame: pl.DataFrame, value_column: str = "price") -> pl.DataFrame:
    """Add a robust z-score using median absolute deviation within the frame."""
    median = frame.select(pl.col(value_column).median()).item()
    mad = frame.select((pl.col(value_column) - median).abs().median()).item()
    scale = 1.4826 * mad
    if scale == 0:
        # When the baseline is perfectly concentrated, any non-median value
        # is anomalous. Use infinity as an explicit, deterministic signal.
        return frame.with_columns(
            pl.when(pl.col(value_column) == median)
            .then(pl.lit(0.0))
            .otherwise(pl.lit(float("inf")))
            .alias("robust_z_score")
        )
    return frame.with_columns(
        ((pl.col(value_column) - median) / scale).alias("robust_z_score")
    )
