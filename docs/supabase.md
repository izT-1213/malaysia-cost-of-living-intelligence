# Supabase setup

Supabase is the application database and serving layer. The scheduled free-tier setup keeps source files only in the temporary GitHub Actions workspace while a run is executing; it stores lookup data, source metadata, and compact summaries in PostgreSQL. Raw observations are optional and disabled by default.

The serving retention policy is 30 days of compact daily area summaries, 7 days of premise-level summaries, and 6 calendar months of monthly summaries. The public dashboard currently reads the latest 7 daily days; the extra daily-summary history supports rolling-window rebuilds, late-arriving data, and future 30-day comparisons without requiring raw observations in Supabase.

## Local setup

1. Create a Supabase project.
2. Run `supabase/migrations/001_initial_schema.sql` in the Supabase SQL Editor.
3. Run `supabase/migrations/002_allow_unmatched_lookup_codes.sql` after it. This preserves transaction rows when the item lookup lags the current feed.
4. Run `supabase/migrations/003_summary_tables.sql` and then `supabase/migrations/004_daily_item_premise_summary.sql`.
5. Run `supabase/migrations/005_dashboard_date_indexes.sql`.
6. Run `supabase/migrations/006_daily_basket_summary.sql` for the canonical dashboard/AI basket totals.
7. Set `SUPABASE_URL` and `SUPABASE_KEY` in the local `.env` file.
8. Keep the service key private. It is for the ingestion job only and must never be shipped to the web app.
9. Leave `STORE_RAW_OBSERVATIONS=false` for the free-tier deployment. Set it to `true` only for an explicitly controlled local run where raw observations are required.

## Fresh free-tier project migration

The old project should not be used for recovery because it is locked in read-only mode. Create a new Free Supabase project, run the four migrations above in order, and then replace the GitHub Actions `SUPABASE_URL` and `SUPABASE_KEY` secrets with the new project's values. The scheduled workflow downloads Parquet files only for the duration of each run and writes compact summaries, so it does not recreate the large raw observation table.

## Data responsibilities

- `item_lookup` and `premise_lookup`: public reference data.
- `price_observations`: optional normalized source observations; the scheduled free-tier workflow does not write this table.
- `daily_item_area_summary`: compact recent daily prices by item and area.
- `daily_basket_summary`: canonical seven-day complete-basket totals by state, shared by the dashboard and AI payload.
- `daily_item_premise_summary`: compact latest-seven-day prices by item and premise for custom basket comparisons.
- `monthly_item_area_summary`: compact historical monthly prices by item and area.
- `monthly_category_summary`: category-level movement based on comparable item changes.
- `source_snapshots`: source URLs, hashes, row counts, and retrieval timestamps for reproducibility.
- `pipeline_runs`: ingestion provenance and operational status.
- `daily_metrics`: dashboard-ready deterministic results.
- `ai_insights`: optional cached explanations of structured metrics.

The public policies intentionally expose curated lookup and metric tables but not raw observations or pipeline credentials.
