"""Small CLI entry point for future scheduled jobs."""

from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(description="Malaysia Cost of Living Intelligence pipeline")
    parser.add_argument("--version", action="version", version="0.1.0")
    subparsers = parser.add_subparsers(dest="command")
    subparsers.add_parser("validate", help="Validate a normalized input file (coming soon)")
    subparsers.add_parser("metrics", help="Build deterministic metric tables (coming soon)")
    args = parser.parse_args()
    if args.command is None:
        parser.print_help()


if __name__ == "__main__":
    main()
