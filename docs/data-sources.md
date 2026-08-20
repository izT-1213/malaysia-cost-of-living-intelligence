# Data sources

## PriceCatcher — initial source

PriceCatcher is the primary high-frequency source. Before production ingestion, verify the current official endpoint, licensing/terms, update cadence, field names, and geographic identifiers from the source owner. Keep a copy of the source metadata alongside each raw batch.

Expected normalized concepts include:

- observation date
- item/product identifier and name
- observed price and unit
- premise identifier and name
- state and district
- source batch identifier

The pipeline accepts aliases for common source column names, but unknown source schemas should be rejected rather than silently guessed.

## Planned extensions

Potential future sources include DOSM CPI, fuel prices, household income, unemployment, wages, Bank Negara exchange rates, OPR, and related financial indicators. Each source needs its own source contract, refresh cadence, provenance, and metric caveats before being added to the public product.
