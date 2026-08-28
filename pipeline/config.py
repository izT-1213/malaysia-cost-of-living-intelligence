"""Environment-backed configuration for local and scheduled pipeline jobs."""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_key: str
    store_raw_observations: bool = False

    @classmethod
    def from_environment(cls) -> "Settings":
        url = os.getenv("SUPABASE_URL", "").strip()
        key = os.getenv("SUPABASE_KEY", "").strip()
        missing = [name for name, value in (("SUPABASE_URL", url), ("SUPABASE_KEY", key)) if not value]
        if missing:
            raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")
        store_raw = os.getenv("STORE_RAW_OBSERVATIONS", "false").strip().lower() in {
            "1", "true", "yes"
        }
        return cls(supabase_url=url, supabase_key=key, store_raw_observations=store_raw)
