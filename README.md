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
```

## Repository map

- `pipeline/` — ingestion, transforms, quality checks, and deterministic metrics
- `analytics/` — notebooks, SQL, and experiments
- `data/` — local raw, processed, and reference data; contents are git-ignored
- `apps/web/` — reserved for the Next.js dashboard
- `docs/` — source, architecture, metric, and roadmap documentation
- `tests/` — automated checks for pipeline behavior

See [PROJECT.md](PROJECT.md) for the product principles and [docs/architecture.md](docs/architecture.md) for the technical design.
