"""Batch loaders for the Supabase-backed serving layer."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date
from typing import Any

import polars as pl

from pipeline.config import Settings
from supabase import Client, create_client


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


def delete_observations_before(client: Client, cutoff: date) -> None:
    """Remove raw observations older than the rolling detail window."""
    client.table("price_observations").delete().lt("observed_date", cutoff.isoformat()).execute()


def load_item_area_summary(
    client: Client,
    frame: pl.DataFrame,
    table: str,
    source_sha256: str,
    batch_size: int = 500,
) -> int:
    """Upsert compact item-area summaries and return rows submitted."""
    table_config = {
        "daily_item_area_summary": ("metric_date", "metric_date,state,district,item_code"),
        "monthly_item_area_summary": ("metric_month", "metric_month,state,district,item_code"),
    }
    if table not in table_config:
        raise ValueError(f"Unsupported summary table: {table}")
    period_column, conflict = table_config[table]
    required = {
        period_column,
        "area_level",
        "state",
        "district",
        "item_code",
        "min_price",
        "median_price",
        "max_price",
        "min_premise_code",
        "max_premise_code",
    }
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"Missing summary columns: {', '.join(sorted(missing))}")

    rows = []
    for row in frame.select(sorted(required)).to_dicts():
        rows.append(
            {
                period_column: row[period_column].isoformat(),
                "area_level": row["area_level"],
                "state": row["state"],
                "district": row["district"] or "",
                "item_code": int(row["item_code"]),
                "min_price": float(row["min_price"]),
                "median_price": float(row["median_price"]),
                "max_price": float(row["max_price"]),
                "min_premise_code": _optional_int(row["min_premise_code"]),
                "max_premise_code": _optional_int(row["max_premise_code"]),
                "source_snapshot_sha256": source_sha256,
            }
        )
    submitted = 0
    for batch in _chunks(rows, batch_size):
        client.table(table).upsert(batch, on_conflict=conflict).execute()
        submitted += len(batch)
    return submitted


def load_source_snapshot(client: Client, metadata: dict[str, Any]) -> int:
    """Upsert one source snapshot metadata record."""
    row = {
        "source_name": metadata["source_name"],
        "source_month": f"{metadata['source_month']}-01"
        if len(metadata["source_month"]) == 7
        else metadata["source_month"],
        "source_url": metadata["source_url"],
        "source_snapshot_sha256": metadata["sha256"],
        "rows_seen": metadata.get("rows_seen"),
        "retrieved_at": metadata["retrieved_at_utc"],
    }
    client.table("source_snapshots").upsert(
        [row], on_conflict="source_name,source_month,source_snapshot_sha256"
    ).execute()
    return 1


def _optional_int(value: Any) -> int | None:
    return None if value is None else int(value)
