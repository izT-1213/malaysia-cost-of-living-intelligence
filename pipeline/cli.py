"""Small CLI entry point for future scheduled jobs."""

from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path

from pipeline.ingestion.pricecatcher import download_monthly_snapshot


def main() -> None:
    parser = argparse.ArgumentParser(description="Malaysia Cost of Living Intelligence pipeline")
    parser.add_argument("--version", action="version", version="0.1.0")
    subparsers = parser.add_subparsers(dest="command")
    subparsers.add_parser("validate", help="Validate a normalized input file (coming soon)")
    subparsers.add_parser("metrics", help="Build deterministic metric tables (coming soon)")
    download_parser = subparsers.add_parser("download", help="Download the current PriceCatcher monthly Parquet")
    download_parser.add_argument("--month", help="Source month in YYYY-MM format; defaults to the current month")
    download_parser.add_argument("--raw-dir", default="data/raw/pricecatcher")
    args = parser.parse_args()
    if args.command is None:
        parser.print_help()
    elif args.command == "download":
        reference_date = date.today()
        if args.month:
            reference_date = date.fromisoformat(f"{args.month}-01")
        result = download_monthly_snapshot(Path(args.raw_dir), reference_date)
        print(f"Downloaded {result.bytes_downloaded:,} bytes to {result.destination}")


if __name__ == "__main__":
    main()
