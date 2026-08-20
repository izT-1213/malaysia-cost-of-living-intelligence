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
