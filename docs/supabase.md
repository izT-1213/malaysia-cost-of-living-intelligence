# Supabase setup

Supabase is the application database and serving layer. Raw source snapshots belong in Supabase Storage; cleaned observations, lookup tables, metrics, and cached insights belong in PostgreSQL.

## Local setup

1. Create a Supabase project.
2. Run `supabase/migrations/001_initial_schema.sql` in the Supabase SQL Editor.
3. Run `supabase/migrations/002_allow_unmatched_lookup_codes.sql` after it. This preserves transaction rows when the item lookup lags the current feed.
4. Set `SUPABASE_URL` and `SUPABASE_KEY` in the local `.env` file.
5. Keep the service key private. It is for the ingestion job only and must never be shipped to the web app.

## Data responsibilities

- `item_lookup` and `premise_lookup`: public reference data.
- `price_observations`: normalized source observations; writes happen through the private pipeline.
- `pipeline_runs`: ingestion provenance and operational status.
- `daily_metrics`: dashboard-ready deterministic results.
- `ai_insights`: optional cached explanations of structured metrics.

The public policies intentionally expose curated lookup and metric tables but not raw observations or pipeline credentials.
