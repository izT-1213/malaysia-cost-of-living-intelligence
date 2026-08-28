"""Command-line entry points for the PriceCatcher pipeline."""

from __future__ import annotations

import argparse
import json
from datetime import date, timedelta
from pathlib import Path

import polars as pl

from pipeline.ingestion.pricecatcher import download_lookup_snapshot, download_monthly_snapshot
from pipeline.storage.supabase import (
    delete_observations_before,
    get_client,
    load_item_area_summary,
    load_lookup,
    load_observations,
    load_item_premise_summary,
    load_source_snapshot,
)
from pipeline.summaries.pricecatcher import summarize_item_area, summarize_item_premise
from pipeline.summaries.windows import (
    combined_source_hash,
    previous_month,
    recent_window,
)
from pipeline.transforms.enrich import enrich_observations
from pipeline.transforms.pricecatcher import normalize_columns


def main() -> None:
    parser = argparse.ArgumentParser(description="Malaysia Cost of Living Intelligence pipeline")
    parser.add_argument("--version", action="version", version="0.1.0")
    subparsers = parser.add_subparsers(dest="command")
    subparsers.add_parser("validate", help="Validate a normalized input file (coming soon)")
    subparsers.add_parser("metrics", help="Build deterministic metric tables (coming soon)")
    download_parser = subparsers.add_parser("download", help="Download the current PriceCatcher monthly Parquet")
    download_parser.add_argument("--month", help="Source month in YYYY-MM format; defaults to the current month")
    download_parser.add_argument("--raw-dir", default="data/raw/pricecatcher")
    lookup_parser = subparsers.add_parser("download-lookups", help="Download PriceCatcher item and premise lookups")
    lookup_parser.add_argument("--raw-dir", default="data/raw/pricecatcher")
    daily_parser = subparsers.add_parser(
        "daily", help="Download the current snapshot and load it into Supabase"
    )
    daily_parser.add_argument("--raw-dir", default="data/raw/pricecatcher")
    daily_parser.add_argument("--batch-size", type=int, default=500)
    daily_summary_parser = subparsers.add_parser(
        "daily-summary", help="Summarize the latest 30 days and load them into Supabase"
    )
    daily_summary_parser.add_argument("--raw-dir", default="data/raw/pricecatcher")
    daily_summary_parser.add_argument("--days", type=int, default=30)
    daily_summary_parser.add_argument("--as-of", help="Processing date in YYYY-MM-DD; defaults to today")
    daily_summary_parser.add_argument("--limit", type=int, help="Optional row limit for a small connectivity test")
    daily_summary_parser.add_argument("--batch-size", type=int, default=2000)
    backfill_parser = subparsers.add_parser(
        "backfill-month", help="Summarize one complete month and load it into Supabase"
    )
    backfill_parser.add_argument("--month", required=True, help="Source month in YYYY-MM")
    backfill_parser.add_argument("--raw-dir", default="data/raw/pricecatcher")
    backfill_parser.add_argument("--limit", type=int, help="Optional row limit for a small connectivity test")
    backfill_parser.add_argument("--batch-size", type=int, default=500)
    load_parser = subparsers.add_parser("load-local", help="Load local PriceCatcher Parquet files into Supabase")
    load_parser.add_argument("--prices", required=True, help="Path to a PriceCatcher monthly Parquet file")
    load_parser.add_argument("--items", required=True, help="Path to the item lookup Parquet file")
    load_parser.add_argument("--premises", required=True, help="Path to the premise lookup Parquet file")
    load_parser.add_argument("--limit", type=int, help="Optional row limit for a small connectivity test")
    load_parser.add_argument("--batch-size", type=int, default=500)
    summary_parser = subparsers.add_parser(
        "load-summary-local", help="Summarize local PriceCatcher data and load it into Supabase"
    )
    summary_parser.add_argument("--prices", required=True, help="Path to a PriceCatcher monthly Parquet file")
    summary_parser.add_argument("--items", required=True, help="Path to the item lookup Parquet file")
    summary_parser.add_argument("--premises", required=True, help="Path to the premise lookup Parquet file")
    summary_parser.add_argument("--limit", type=int, help="Optional row limit for a small connectivity test")
    summary_parser.add_argument("--batch-size", type=int, default=500)
    args = parser.parse_args()
    if args.command is None:
        parser.print_help()
    elif args.command == "download":
        reference_date = date.today()
        if args.month:
            reference_date = date.fromisoformat(f"{args.month}-01")
        result = download_monthly_snapshot(Path(args.raw_dir), reference_date)
        print(f"Downloaded {result.bytes_downloaded:,} bytes to {result.destination}")
    elif args.command == "download-lookups":
        for lookup_name in ("item", "premise"):
            result = download_lookup_snapshot(lookup_name, Path(args.raw_dir))
            print(f"Downloaded {lookup_name} lookup ({result.bytes_downloaded:,} bytes) to {result.destination}")
    elif args.command == "daily":
        raw_dir = Path(args.raw_dir)
        price_result = download_monthly_snapshot(raw_dir)
        item_result = download_lookup_snapshot("item", raw_dir)
        premise_result = download_lookup_snapshot("premise", raw_dir)
        client = get_client()
        item_count = load_lookup(client, pl.read_parquet(item_result.destination), "item_lookup", args.batch_size)
        premise_count = load_lookup(
            client, pl.read_parquet(premise_result.destination), "premise_lookup", args.batch_size
        )
        prices = pl.read_parquet(price_result.destination)
        observation_count = load_observations(
            client,
            prices,
            date.fromisoformat(f"{price_result.source_month}-01"),
            price_result.sha256,
            args.batch_size,
        )
        print(
            f"Daily load complete: {item_count:,} items, {premise_count:,} premises, "
            f"{observation_count:,} observations"
        )
    elif args.command == "daily-summary":
        raw_dir = Path(args.raw_dir)
        as_of = date.fromisoformat(args.as_of) if args.as_of else date.today()
        current_result = download_monthly_snapshot(raw_dir, as_of)
        previous_result = download_monthly_snapshot(raw_dir, previous_month(as_of))
        item_result = download_lookup_snapshot("item", raw_dir)
        premise_result = download_lookup_snapshot("premise", raw_dir)
        client = get_client()
        item_count = load_lookup(client, pl.read_parquet(item_result.destination), "item_lookup", args.batch_size)
        premise_count = load_lookup(
            client, pl.read_parquet(premise_result.destination), "premise_lookup", args.batch_size
        )
        current = normalize_columns(pl.read_parquet(current_result.destination))
        previous = normalize_columns(pl.read_parquet(previous_result.destination))
        if args.limit:
            current = current.head(args.limit)
            previous = previous.head(args.limit)
        prices = recent_window(pl.concat([previous, current], how="vertical_relaxed"), as_of, args.days)
        delete_observations_before(client, as_of - timedelta(days=args.days - 1))
        for source_prices, result in ((previous, previous_result), (current, current_result)):
            source_prices = recent_window(source_prices, as_of, args.days)
            if source_prices.height:
                load_observations(
                    client,
                    source_prices.rename({"item_id": "item_code", "premise_id": "premise_code"}),
                    date.fromisoformat(f"{result.source_month}-01"),
                    result.sha256,
                    args.batch_size,
                )
        enriched = enrich_observations(
            prices,
            pl.read_parquet(item_result.destination),
            pl.read_parquet(premise_result.destination),
        )
        source_hash = combined_source_hash([current_result.sha256, previous_result.sha256])
        for result, rows_seen in ((previous_result, previous.height), (current_result, current.height)):
            load_source_snapshot(client, {
                "source_name": "pricecatcher",
                "source_month": result.source_month,
                "source_url": result.source_url,
                "sha256": result.sha256,
                "rows_seen": rows_seen,
                "retrieved_at_utc": result.retrieved_at_utc,
            })
        daily = summarize_item_area(enriched, period="daily")
        daily_count = load_item_area_summary(
            client, daily, "daily_item_area_summary", source_hash, args.batch_size
        )
        premise_daily = summarize_item_premise(enriched)
        premise_summary_count = load_item_premise_summary(client, premise_daily, source_hash, args.batch_size)
        print(
            f"Daily summary load complete: {item_count:,} items, {premise_count:,} premises, "
            f"{daily_count:,} area summaries and {premise_summary_count:,} premise summaries across {args.days} days"
        )
    elif args.command == "backfill-month":
        raw_dir = Path(args.raw_dir)
        source_month = date.fromisoformat(f"{args.month}-01")
        price_result = download_monthly_snapshot(raw_dir, source_month)
        item_result = download_lookup_snapshot("item", raw_dir)
        premise_result = download_lookup_snapshot("premise", raw_dir)
        prices = normalize_columns(pl.read_parquet(price_result.destination))
        if args.limit:
            prices = prices.head(args.limit)
        enriched = enrich_observations(
            prices,
            pl.read_parquet(item_result.destination),
            pl.read_parquet(premise_result.destination),
        )
        client = get_client()
        load_lookup(client, pl.read_parquet(item_result.destination), "item_lookup", args.batch_size)
        load_lookup(client, pl.read_parquet(premise_result.destination), "premise_lookup", args.batch_size)
        load_source_snapshot(client, {
            "source_name": "pricecatcher",
            "source_month": price_result.source_month,
            "source_url": price_result.source_url,
            "sha256": price_result.sha256,
            "rows_seen": prices.height,
            "retrieved_at_utc": price_result.retrieved_at_utc,
        })
        monthly = summarize_item_area(enriched, period="monthly")
        monthly_count = load_item_area_summary(
            client, monthly, "monthly_item_area_summary", price_result.sha256, args.batch_size
        )
        print(f"Backfill complete for {args.month}: {monthly_count:,} monthly summaries")
    elif args.command == "load-local":
        prices_path = Path(args.prices)
        metadata_path = prices_path.parent / "metadata.json"
        metadata = json.loads(metadata_path.read_text())
        prices = pl.read_parquet(prices_path)
        if args.limit:
            prices = prices.head(args.limit)
        client = get_client()
        item_count = load_lookup(client, pl.read_parquet(args.items), "item_lookup", args.batch_size)
        premise_count = load_lookup(client, pl.read_parquet(args.premises), "premise_lookup", args.batch_size)
        source_month = date.fromisoformat(f"{metadata['source_month']}-01")
        observation_count = load_observations(
            client, prices, source_month, metadata["sha256"], args.batch_size
        )
        print(f"Loaded {item_count} items, {premise_count} premises, {observation_count} observations")
    elif args.command == "load-summary-local":
        prices_path = Path(args.prices)
        metadata = json.loads((prices_path.parent / "metadata.json").read_text())
        prices = pl.read_parquet(prices_path)
        if args.limit:
            prices = prices.head(args.limit)
        enriched = enrich_observations(
            normalize_columns(prices),
            pl.read_parquet(args.items),
            pl.read_parquet(args.premises),
        )
        client = get_client()
        load_source_snapshot(client, {**metadata, "rows_seen": prices.height})
        daily = summarize_item_area(enriched, period="daily")
        monthly = summarize_item_area(enriched, period="monthly")
        daily_count = load_item_area_summary(
            client, daily, "daily_item_area_summary", metadata["sha256"], args.batch_size
        )
        monthly_count = load_item_area_summary(
            client, monthly, "monthly_item_area_summary", metadata["sha256"], args.batch_size
        )
        print(f"Loaded {daily_count:,} daily and {monthly_count:,} monthly summaries")


if __name__ == "__main__":
    main()
