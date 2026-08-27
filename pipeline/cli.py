"""Command-line entry points for the PriceCatcher pipeline."""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

import polars as pl

from pipeline.ingestion.pricecatcher import download_lookup_snapshot, download_monthly_snapshot
from pipeline.storage.supabase import get_client, load_lookup, load_observations


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
    load_parser = subparsers.add_parser("load-local", help="Load local PriceCatcher Parquet files into Supabase")
    load_parser.add_argument("--prices", required=True, help="Path to a PriceCatcher monthly Parquet file")
    load_parser.add_argument("--items", required=True, help="Path to the item lookup Parquet file")
    load_parser.add_argument("--premises", required=True, help="Path to the premise lookup Parquet file")
    load_parser.add_argument("--limit", type=int, help="Optional row limit for a small connectivity test")
    load_parser.add_argument("--batch-size", type=int, default=500)
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


if __name__ == "__main__":
    main()
