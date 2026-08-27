"""Normalize PriceCatcher-like records into a stable internal schema."""

from __future__ import annotations

import polars as pl

ALIASES = {
    "date": ("date", "observation_date", "price_date"),
    "item_id": ("item_id", "item_code", "product_id", "id_item"),
    "item_name": ("item_name", "product_name", "item"),
    "price": ("price", "observed_price", "harga"),
    "premise_id": ("premise_id", "premise_code", "kod_premis"),
    "premise_name": ("premise_name", "premise", "nama_premis"),
    "state": ("state", "state_name", "negeri"),
    "district": ("district", "district_name", "daerah"),
    "unit": ("unit", "unit_name", "satuan"),
}


def normalize_columns(frame: pl.DataFrame) -> pl.DataFrame:
    """Return a stable schema and reject missing required concepts."""
    available = set(frame.columns)
    expressions: list[pl.Expr] = []
    required = {"date", "price"}
    for target, candidates in ALIASES.items():
        source = next((candidate for candidate in candidates if candidate in available), None)
        if source is None:
            if target in required:
                raise ValueError(f"Missing required PriceCatcher column: {target}")
            if target == "item_name" and "item_id" not in available and "item_code" not in available:
                raise ValueError("Missing required PriceCatcher column: item_name or item_id")
            expressions.append(pl.lit(None).alias(target))
        else:
            expressions.append(pl.col(source).alias(target))

    normalized = frame.select(expressions)
    date_expression = (
        pl.col("date").str.to_date(strict=False)
        if normalized.schema["date"] == pl.String
        else pl.col("date").cast(pl.Date, strict=False)
    )
    return normalized.with_columns(
        date_expression,
        pl.col("price").cast(pl.Float64, strict=False),
        pl.col("item_name").cast(pl.String),
    )
