"""Batch loaders for the Supabase-backed serving layer."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any, Iterable

import polars as pl
from supabase import Client, create_client

from pipeline.config import Settings


def get_client() -> Client:
    settings = Settings.from_environment()
    return create_client(settings.supabase_url, settings.supabase_key)


def _chunks(rows: Iterable[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    batch: list[dict[str, Any]] = []
    for row in rows:
        batch.append(row)
        if len(batch) == size:
            yield batch
            batch = []
    if batch:
        yield batch


def load_lookup(client: Client, frame: pl.DataFrame, table: str, batch_size: int = 500) -> int:
    """Upsert one lookup frame and return rows submitted."""
    if table == "item_lookup":
        rows = (
            frame.filter(pl.col("item_code") >= 0)
            .filter(pl.col("item").is_not_null())
            .select("item_code", "item", "unit", "item_group", "item_category")
            .to_dicts()
        )
        conflict = "item_code"
    elif table == "premise_lookup":
        rows = (
            frame.filter(pl.col("premise_code").is_not_null())
            .with_columns(pl.col("premise_code").cast(pl.Int64, strict=False))
            .select("premise_code", "premise", "address", "premise_type", "state", "district")
            .to_dicts()
        )
        conflict = "premise_code"
    else:
        raise ValueError(f"Unsupported lookup table: {table}")
    submitted = 0
    for batch in _chunks(rows, batch_size):
        client.table(table).upsert(batch, on_conflict=conflict).execute()
        submitted += len(batch)
    return submitted


def load_observations(
    client: Client,
    frame: pl.DataFrame,
    source_month: date,
    source_sha256: str,
    batch_size: int = 500,
) -> int:
    """Upsert normalized observations with a deterministic idempotency key."""
    required = {"date", "premise_code", "item_code", "price"}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"Missing source columns: {', '.join(sorted(missing))}")
    rows = (
        {
            "observation_key": f"{row['date'].isoformat()}|{row['premise_code']}|{row['item_code']}",
            "observed_date": row["date"].isoformat(),
            "premise_code": int(row["premise_code"]),
            "item_code": int(row["item_code"]),
            "price": float(row["price"]),
            "source_month": source_month.isoformat(),
            "source_snapshot_sha256": source_sha256,
        }
        for row in frame.select("date", "premise_code", "item_code", "price").iter_rows(named=True)
    )
    submitted = 0
    for batch in _chunks(rows, batch_size):
        client.table("price_observations").upsert(batch, on_conflict="observation_key").execute()
        submitted += len(batch)
    return submitted
