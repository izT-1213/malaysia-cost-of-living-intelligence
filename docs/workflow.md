# PriceCatcher processing workflow

This project separates the full source data from the compact data used by the
dashboard. The source files are monthly Parquet snapshots published by
data.gov.my. A GitHub Actions runner downloads them temporarily, processes
them, uploads summaries to Supabase, and is then discarded.

## Historical months

For each available month:

1. Download the monthly Parquet file.
2. Preserve the downloaded file during the job before transforming it.
3. Normalize the source columns and map item and premise codes through the
   lookup tables.
4. Calculate daily and monthly item/location summaries at state and district level.
5. Calculate category movement using comparable item-level changes rather than
   combining prices with incompatible units.
6. Upsert the compact summaries into Supabase.
7. Record the source URL, month, retrieval time, row count, and SHA-256 hash.
8. Discard the temporary Parquet file when the runner ends.

Historical monthly summaries remain in Supabase. Historical raw observations do
not need to be copied into Supabase because the official source files can be
downloaded again using the recorded provenance.

## Rolling recent window

The daily job keeps the latest 30 calendar days available for recent analysis.
Because the window can cross a month boundary, the job downloads both the
current and previous monthly Parquet files, then filters the combined data to
the 30-day window.

Each run replaces summaries for the affected dates. This handles new records
and corrections to recently published dates while remaining idempotent.

The raw recent Parquet data is temporary job input. Supabase stores the compact
recent summaries, not the full rolling raw dataset.

## Month transition

When a new month becomes available, the job continues to calculate the recent
30-day window from two source files. The previous month’s compact summaries are
retained, and the new month’s summaries are added or updated.

The source is surveillance data: missing item/premise/date combinations are
not interpreted as zero prices. Metric calculations use only observed prices.

Summary rows carry an `area_level` of `state` or `district`. State-level rows
use an empty `district` value; this makes the summary grain explicit and keeps
upserts deterministic.

## Planned execution order

1. [x] Apply `supabase/migrations/003_summary_tables.sql`.
2. [x] Implement and test the summarization functions locally.
3. Run the manual `PriceCatcher historical monthly backfill` workflow for the
   available month range.
4. [x] Replace the current full-raw daily command with the rolling-summary job.
5. Run the revised job manually and verify Supabase size and summary rows.
6. Re-enable the daily schedule.
