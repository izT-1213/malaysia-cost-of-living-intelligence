# Roadmap

## Phase 1 — foundation

- [x] Repository structure and engineering guidance
- [x] Local configuration and dependency baseline
- [x] Normalization, validation, and deterministic metric primitives
- [ ] Verify live PriceCatcher source contract

## Phase 2 — usable local product

- [x] Incremental PriceCatcher fetcher with provenance metadata
- [ ] Parquet partitions and DuckDB exploration queries
- [ ] Compact daily and monthly summary tables
- [ ] Historical PriceCatcher summary backfill
- [ ] Data-quality report and sample fixture

## Phase 3 — public dashboard

- [ ] Next.js/TypeScript/Tailwind app
- [ ] Responsive trend, map, basket, and anomaly views
- [ ] Explain metric definitions and data freshness in the UI

## Phase 4 — intelligent updates

- [ ] Change detector and structured insight payloads
- [ ] Provider abstraction and cached optional AI explanations
- [ ] GitHub Actions-compatible summary pipeline
- [ ] Add carefully documented public datasets beyond PriceCatcher
