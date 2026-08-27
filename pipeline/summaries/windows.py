"""Date-window helpers for incremental PriceCatcher processing."""

from __future__ import annotations

import hashlib
from datetime import date, timedelta

import polars as pl


def month_start(value: date) -> date:
    """Return the first day of the month containing ``value``."""
    return value.replace(day=1)


def previous_month(value: date) -> date:
    """Return the first day of the month before ``value``."""
    return month_start(month_start(value) - timedelta(days=1))


def recent_window(frame: pl.DataFrame, as_of: date, days: int = 30) -> pl.DataFrame:
    """Keep the latest inclusive calendar-day window from normalized observations."""
    if days < 1:
        raise ValueError("days must be at least 1")
    cutoff = as_of - timedelta(days=days - 1)
    return frame.filter(
        pl.col("date").is_between(cutoff, as_of, closed="both")
    )


def combined_source_hash(hashes: list[str]) -> str:
    """Create a deterministic provenance hash for multiple source snapshots."""
    return hashlib.sha256("|".join(sorted(hashes)).encode()).hexdigest()
