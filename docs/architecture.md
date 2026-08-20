# Architecture

## Data flow

```text
official source
    -> raw immutable files
    -> normalized Parquet
    -> quality checks
    -> deterministic metrics
    -> structured insight payload
    -> optional cached AI explanation
    -> web dashboard
```

The analytics layer must not depend on the web application. Local development uses Parquet and can query it with DuckDB; a future storage adapter can point the same interfaces at PostgreSQL/Supabase.

## Layers

- **Ingestion:** fetch or import source data, record retrieval metadata, and avoid overwriting raw files.
- **Transforms:** normalize column names/types and derive stable identifiers.
- **Quality:** validate required columns, dates, prices, and geographic fields; fail loudly on structural problems.
- **Metrics:** calculate price changes, basket contributions, volatility, rankings, and anomalies using deterministic code.
- **AI insights:** receive only compact structured metrics; return cached text with provider/model metadata.
- **Web:** present metrics and caveats; never calculate authoritative metrics in React.

## Idempotency

Every ingestion batch should have a source identifier and retrieval timestamp. Raw files are content-addressable or source-date partitioned. Transforms should be rerunnable without changing results for the same input.
