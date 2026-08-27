"""Join PriceCatcher observations to official lookup tables."""

from __future__ import annotations

import polars as pl

from pipeline.transforms.geography import canonicalize_geography


def enrich_observations(
    observations: pl.DataFrame,
    item_lookup: pl.DataFrame,
    premise_lookup: pl.DataFrame,
) -> pl.DataFrame:
    """Add item and premise attributes using deterministic left joins."""
    required_observation_columns = {"date", "item_id", "premise_id", "price"}
    missing = required_observation_columns - set(observations.columns)
    if missing:
        raise ValueError(f"Missing normalized observation columns: {', '.join(sorted(missing))}")

    items = item_lookup.rename({
        "item_code": "item_id",
        "item": "item_name",
    })
    premises = premise_lookup.rename({
        "premise_code": "premise_id",
        "premise": "premise_name",
    })
    items = items.with_columns(pl.col("item_id").cast(pl.Int64, strict=False))
    premises = premises.with_columns(pl.col("premise_id").cast(pl.Int64, strict=False))
    item_attributes = set(items.columns) - {"item_id"}
    premise_attributes = set(premises.columns) - {"premise_id"}
    existing_attributes = (item_attributes | premise_attributes) & set(observations.columns)
    base = observations.drop(sorted(existing_attributes))
    result = base.join(items, on="item_id", how="left", validate="m:1")
    return canonicalize_geography(result.join(premises, on="premise_id", how="left", validate="m:1"))
