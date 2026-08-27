"""Download daily-updated monthly PriceCatcher snapshots."""

from __future__ import annotations

import hashlib
import json
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path

import httpx

PRICECATCHER_BASE_URL = "https://storage.data.gov.my/pricecatcher"
LOOKUP_URLS = {
    "item": f"{PRICECATCHER_BASE_URL}/lookup_item.parquet",
    "premise": f"{PRICECATCHER_BASE_URL}/lookup_premise.parquet",
}


@dataclass(frozen=True)
class DownloadResult:
    source_month: str
    source_url: str
    destination: Path
    sha256: str
    bytes_downloaded: int
    retrieved_at_utc: str


def month_string(value: date | None = None) -> str:
    """Return the source month as YYYY-MM, defaulting to today."""
    value = value or date.today()
    return value.strftime("%Y-%m")


def monthly_url(value: date | None = None) -> str:
    """Build the official PriceCatcher monthly Parquet URL."""
    month = month_string(value)
    return f"{PRICECATCHER_BASE_URL}/pricecatcher_{month}.parquet"


def download_monthly_snapshot(
    raw_dir: Path,
    value: date | None = None,
    timeout_seconds: float = 120.0,
) -> DownloadResult:
    """Download a monthly source snapshot."""
    month = month_string(value)
    url = monthly_url(value)
    return _download_url_snapshot(raw_dir, url, f"pricecatcher_{month}.parquet", month, timeout_seconds)


def download_lookup_snapshot(
    lookup_name: str,
    raw_dir: Path,
    timeout_seconds: float = 120.0,
) -> DownloadResult:
    """Download a static PriceCatcher lookup table."""
    if lookup_name not in LOOKUP_URLS:
        raise ValueError(f"Unknown lookup: {lookup_name}; expected one of {sorted(LOOKUP_URLS)}")
    return _download_url_snapshot(
        raw_dir,
        LOOKUP_URLS[lookup_name],
        f"lookup_{lookup_name}.parquet",
        "static",
        timeout_seconds,
    )


def _download_url_snapshot(
    raw_dir: Path,
    url: str,
    filename: str,
    source_month: str,
    timeout_seconds: float,
) -> DownloadResult:
    """Download a URL, preserving it under a content-addressed folder."""
    raw_dir.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    digest = hashlib.sha256()
    bytes_downloaded = 0
    try:
        with tempfile.NamedTemporaryFile(dir=raw_dir, prefix=".download-", delete=False) as temp:
            temp_path = Path(temp.name)
            with httpx.stream("GET", url, follow_redirects=True, timeout=timeout_seconds) as response:
                response.raise_for_status()
                for chunk in response.iter_bytes():
                    temp.write(chunk)
                    digest.update(chunk)
                    bytes_downloaded += len(chunk)

        sha256 = digest.hexdigest()
        batch_dir = raw_dir / sha256[:12]
        batch_dir.mkdir(parents=True, exist_ok=True)
        destination = batch_dir / filename
        if destination.exists():
            temp_path.unlink()
        else:
            temp_path.replace(destination)
        retrieved_at = datetime.now(timezone.utc).isoformat()
        metadata = {
            "source_name": "pricecatcher",
            "source_month": source_month,
            "source_url": url,
            "sha256": sha256,
            "bytes_downloaded": bytes_downloaded,
            "retrieved_at_utc": retrieved_at,
        }
        (batch_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
        return DownloadResult(source_month, url, destination, sha256, bytes_downloaded, retrieved_at)
    except Exception:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()
        raise
