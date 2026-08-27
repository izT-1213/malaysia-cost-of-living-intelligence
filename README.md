# Malaysia Cost of Living Intelligence

An analytics-first, open-data project for Malaysian cost-of-living and consumer-price intelligence.

## Quick start

Requires Python 3.11+.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
python -m pytest
python -m pipeline.cli --help
# Download the current month's PriceCatcher Parquet snapshot
python -m pipeline.cli download
# Run the end-to-end local load after setting SUPABASE_URL and SUPABASE_KEY
python -m pipeline.cli daily
# Load only the latest 30 days as compact summaries
python -m pipeline.cli daily-summary
# Test the rolling path with a small sample
python -m pipeline.cli daily-summary --limit 1000
# Backfill one complete historical month as compact summaries
python -m pipeline.cli backfill-month --month 2026-07
```

## Daily update automation

The GitHub Actions workflow in `.github/workflows/pricecatcher-daily.yml` can be
run manually or on its daily schedule. Add `SUPABASE_URL` and `SUPABASE_KEY` as
GitHub repository secrets before running it. The job downloads the current
monthly snapshot and lookup files, then upserts them idempotently into Supabase.

## Repository map

- `pipeline/` — ingestion, transforms, quality checks, and deterministic metrics
- `analytics/` — notebooks, SQL, and experiments
- `data/` — local raw, processed, and reference data; contents are git-ignored
- `apps/web/` — reserved for the Next.js dashboard
- `docs/` — source, architecture, metric, and roadmap documentation
- `tests/` — automated checks for pipeline behavior

See [PROJECT.md](PROJECT.md) for the product principles and [docs/architecture.md](docs/architecture.md) for the technical design.
