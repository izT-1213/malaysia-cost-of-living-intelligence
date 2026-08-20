# Agent guidance

## Project principles

- Keep financial and price statistics deterministic and reproducible.
- Preserve raw source files before transformation.
- Make pipeline jobs incremental and idempotent.
- Keep AI optional: it may explain structured metrics, but never calculate them.
- Prefer small, reviewable changes and focused verification.

## Local commands

```bash
python -m pytest
python -m pipeline.cli --help
```

The project currently uses local Parquet and DuckDB-compatible layers. Do not add paid infrastructure or credentials to the repository.
