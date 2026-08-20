"""Local ingestion helpers that preserve source files and provenance."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path


def copy_with_provenance(source: Path, raw_dir: Path, source_name: str = "pricecatcher") -> Path:
    """Copy a source file into a content-addressed raw batch and write metadata."""
    if not source.is_file():
        raise FileNotFoundError(source)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    batch_dir = raw_dir / source_name / digest[:12]
    batch_dir.mkdir(parents=True, exist_ok=True)
    destination = batch_dir / source.name
    if not destination.exists():
        destination.write_bytes(source.read_bytes())
    metadata = {
        "source_name": source_name,
        "source_filename": source.name,
        "sha256": digest,
        "retrieved_at_utc": datetime.now(UTC).isoformat(),
    }
    (batch_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    return destination
