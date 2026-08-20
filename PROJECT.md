# Malaysia Cost of Living Intelligence

Malaysia Cost of Living Intelligence is a public, continuously updating data product for understanding Malaysian consumer prices. The first high-frequency source is the official PriceCatcher dataset, with a design that can later incorporate DOSM CPI, fuel prices, income, labour, exchange rates, and financial indicators.

## Product promise

Make complicated price data understandable to ordinary Malaysians while preserving an auditable path from source data to metrics and explanations.

## Non-negotiables

1. **Analytics first, AI second.** Raw data is deterministically transformed into structured metrics before any AI explanation is generated.
2. **Open and free by default.** Prefer official public sources and free-tier-compatible infrastructure.
3. **Raw data is immutable.** Store source responses/files separately from processed layers.
4. **AI is optional.** The dashboard remains useful when no model provider is configured.

## Initial scope

- PriceCatcher ingestion contract and local file ingestion.
- Schema normalization and validation hooks.
- Deterministic price-change and anomaly metric foundations.
- Local Parquet/DuckDB storage conventions.
- A future Next.js web app under `apps/web`.

## Out of scope for bootstrap

- Production credentials or paid hosting.
- Live scheduled jobs.
- Authoritative assumptions about PriceCatcher's current API schema before the source contract is verified.
