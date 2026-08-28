"""Deterministic PriceCatcher summaries for the dashboard serving layer."""

from __future__ import annotations

from typing import Literal

import polars as pl


def summarize_item_area(
    frame: pl.DataFrame,
    period: Literal["daily", "monthly"] = "daily",
) -> pl.DataFrame:
    """Summarize observed prices at state and district level.

    The input must be normalized and enriched with ``date``, ``item_id``,
    ``premise_id``, ``price``, ``state``, and ``district``. Missing observations
    are excluded rather than treated as zero. Cheapest and most expensive
    premise codes use price first and premise code second as deterministic
    tie-breakers.
    """
    required = {"date", "item_id", "premise_id", "price", "state", "district"}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"Missing summary columns: {', '.join(sorted(missing))}")
    if period not in {"daily", "monthly"}:
        raise ValueError("period must be 'daily' or 'monthly'")

    base = (
        frame.select("date", "item_id", "premise_id", "price", "state", "district")
        .with_columns(
            pl.col("date").cast(pl.Date, strict=False),
            pl.col("item_id").cast(pl.Int64, strict=False),
            pl.col("premise_id").cast(pl.Int64, strict=False),
            pl.col("price").cast(pl.Float64, strict=False),
            pl.col("state").cast(pl.String),
            pl.col("district").cast(pl.String),
        )
        .filter(
            pl.col("date").is_not_null()
            & pl.col("item_id").is_not_null()
            & pl.col("premise_id").is_not_null()
            & pl.col("price").is_not_null()
            & (pl.col("price") > 0)
            & pl.col("state").is_not_null()
        )
    )

    if base.is_empty():
        return _empty_summary(period)

    period_column = "metric_date"
    if period == "monthly":
        base = base.with_columns(pl.col("date").dt.truncate("1mo").alias("metric_month"))
        period_column = "metric_month"
    else:
        base = base.with_columns(pl.col("date").alias("metric_date"))

    outputs = [
        _summarize_group(base, [period_column, "state", "item_id"], "state", period_column),
    ]
    district_base = base.filter(pl.col("district").is_not_null())
    if not district_base.is_empty():
        outputs.append(
            _summarize_group(
                district_base,
                [period_column, "state", "district", "item_id"],
                "district",
                period_column,
            )
        )
    return (
        pl.concat(outputs, how="diagonal_relaxed")
        .select(_summary_columns(period_column))
        .sort([period_column, "area_level", "state", "district", "item_code"])
    )


def summarize_item_premise(frame: pl.DataFrame) -> pl.DataFrame:
    """Summarize daily prices by premise and item for the rolling detail window."""
    required = {"date", "item_id", "premise_id", "price"}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"Missing premise summary columns: {', '.join(sorted(missing))}")
    base = (
        frame.select("date", "item_id", "premise_id", "price")
        .with_columns(
            pl.col("date").cast(pl.Date, strict=False),
            pl.col("item_id").cast(pl.Int64, strict=False),
            pl.col("premise_id").cast(pl.Int64, strict=False),
            pl.col("price").cast(pl.Float64, strict=False),
        )
        .filter(
            pl.col("date").is_not_null()
            & pl.col("item_id").is_not_null()
            & pl.col("premise_id").is_not_null()
            & pl.col("price").is_not_null()
            & (pl.col("price") > 0)
        )
    )
    if base.is_empty():
        return pl.DataFrame(schema={
            "metric_date": pl.Date, "premise_code": pl.Int64, "item_code": pl.Int64,
            "min_price": pl.Float64, "median_price": pl.Float64, "max_price": pl.Float64,
        })
    return base.with_columns(pl.col("date").alias("metric_date")).group_by(
        ["metric_date", "premise_id", "item_id"]
    ).agg(
        pl.col("price").min().alias("min_price"),
        pl.col("price").median().alias("median_price"),
        pl.col("price").max().alias("max_price"),
    ).rename({"premise_id": "premise_code", "item_id": "item_code"}).sort(
        ["metric_date", "premise_code", "item_code"]
    )


def _summarize_group(
    frame: pl.DataFrame,
    group_columns: list[str],
    area_level: str,
    period_column: str,
) -> pl.DataFrame:
    stats = frame.group_by(group_columns).agg(
        pl.col("price").min().alias("min_price"),
        pl.col("price").median().alias("median_price"),
        pl.col("price").max().alias("max_price"),
    )
    min_premises = (
        frame.sort([*group_columns, "price", "premise_id"])
        .group_by(group_columns)
        .agg(pl.col("premise_id").first().alias("min_premise_code"))
    )
    max_premises = (
        frame.sort([*group_columns, "price", "premise_id"], descending=[False] * len(group_columns) + [True, False])
        .group_by(group_columns)
        .agg(pl.col("premise_id").first().alias("max_premise_code"))
    )
    result = stats.join(min_premises, on=group_columns).join(max_premises, on=group_columns)
    district_expression = (
        pl.lit("") if area_level == "state" else pl.col("district")
    )
    return result.with_columns(
        pl.lit(area_level).alias("area_level"),
        pl.col("item_id").alias("item_code"),
        district_expression.alias("district"),
    ).select(_summary_columns(period_column))


def _summary_columns(period_column: str) -> list[str]:
    return [
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
    ]


def _empty_summary(period: Literal["daily", "monthly"]) -> pl.DataFrame:
    period_column = "metric_date" if period == "daily" else "metric_month"
    return pl.DataFrame(
        schema={
            period_column: pl.Date,
            "area_level": pl.String,
            "state": pl.String,
            "district": pl.String,
            "item_code": pl.Int64,
            "min_price": pl.Float64,
            "median_price": pl.Float64,
            "max_price": pl.Float64,
            "min_premise_code": pl.Int64,
            "max_premise_code": pl.Int64,
        }
    )
