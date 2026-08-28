"""Optional explanation boundary for structured analytical results."""

from __future__ import annotations

import os
import json
from datetime import date
from typing import Any, Protocol

import httpx
import polars as pl


class InsightProvider(Protocol):
    def explain(self, payload: dict[str, Any]) -> str: ...


class DisabledInsightProvider:
    """Safe default: the product works without an AI provider."""

    def explain(self, payload: dict[str, Any]) -> str:
        del payload
        return ""


def build_daily_insight_payload(summary: pl.DataFrame, as_of: date) -> dict[str, Any]:
    """Create a small, deterministic payload for an optional explanation."""
    state_rows = summary.filter(pl.col("area_level") == "state")
    latest_date = state_rows.select(pl.col("metric_date").max()).item() if state_rows.height else None
    latest = state_rows.filter(pl.col("metric_date") == latest_date) if latest_date else state_rows
    item_stats = (
        latest.group_by("item_code")
        .agg(pl.col("median_price").median().alias("median_price"))
        .sort("median_price", descending=True)
    )
    state_stats = (
        latest.group_by("state")
        .agg(
            pl.col("median_price").median().alias("median_price"),
            pl.col("item_code").n_unique().alias("items_observed"),
        )
        .sort("state")
    )
    return {
        "as_of": as_of.isoformat(),
        "latest_metric_date": latest_date.isoformat() if latest_date else None,
        "states_observed": latest.select(pl.col("state").n_unique()).item() if latest.height else 0,
        "items_observed": item_stats.height,
        "states": [
            {
                "state": row["state"],
                "median_price": round(float(row["median_price"]), 2),
                "items_observed": int(row["items_observed"]),
            }
            for row in state_stats.to_dicts()
        ],
        "highest_median_items": [
            {"item_code": int(row["item_code"]), "median_price": round(float(row["median_price"]), 2)}
            for row in item_stats.head(3).to_dicts()
        ],
        "lowest_median_items": [
            {"item_code": int(row["item_code"]), "median_price": round(float(row["median_price"]), 2)}
            for row in item_stats.tail(3).sort("median_price").to_dicts()
        ],
    }


def fallback_explanation(payload: dict[str, Any]) -> str:
    """Provide useful copy when no external AI provider is configured."""
    return (
        f"The latest comparison covers {payload.get('items_observed', 0)} tracked items across "
        f"{payload.get('states_observed', 0)} states using observations through "
        f"{payload.get('latest_metric_date') or payload.get('as_of')}. Prices are calculated "
        "from structured PriceCatcher summaries; incomplete coverage is not treated as zero."
    )


def fallback_state_explanations(payload: dict[str, Any]) -> dict[str, str]:
    """Create state notes without making unsupported causal claims."""
    states = payload.get("states", [])
    if not states:
        return {}
    median = sum(float(row["median_price"]) for row in states) / len(states)
    return {
        row["state"]: (
            f"{row['state']} has a median tracked-item price of RM {row['median_price']:.2f} "
            f"across {row['items_observed']} items. This is "
            f"{'above' if row['median_price'] >= median else 'below'} the cross-state median."
        )
        for row in states
    }


class GeminiInsightProvider:
    """Small Gemini API adapter; it receives summaries, never raw observations."""

    def __init__(self, api_key: str, model: str) -> None:
        self.api_key = api_key
        self.model = model

    def explain(self, payload: dict[str, Any]) -> str:
        prompt = (
            "Write one concise, factual insight for a public Malaysian food-price dashboard. "
            "Use only the supplied JSON. Do not calculate new metrics, invent item names, "
            "or imply causation. Return plain text in no more than two sentences.\n\n"
            f"JSON:\n{payload}"
        )
        response = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
            params={"key": self.api_key},
            json={"contents": [{"parts": [{"text": prompt}]}]},
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        return data["candidates"][0]["content"]["parts"][0]["text"].strip()


def generate_insight(payload: dict[str, Any]) -> tuple[str, str, str | None]:
    """Return text, provider label, and model without making AI mandatory."""
    provider_name = os.getenv("AI_PROVIDER", "disabled").strip().lower()
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
    if provider_name == "gemini" and api_key:
        try:
            return GeminiInsightProvider(api_key, model).explain(payload), "gemini", model
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
            pass
    return fallback_explanation(payload), "rule_based", None


def generate_insight_bundle(payload: dict[str, Any]) -> tuple[dict[str, Any], str, str | None]:
    """Return a general note and state notes, with a deterministic fallback."""
    provider_name = os.getenv("AI_PROVIDER", "disabled").strip().lower()
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
    fallback = {
        "general": fallback_explanation(payload),
        "states": fallback_state_explanations(payload),
    }
    if provider_name != "gemini" or not api_key:
        return fallback, "rule_based", None
    prompt = (
        "Return valid JSON only with keys general and states. Write a concise, factual "
        "insight for a Malaysian grocery-price dashboard. Use only the supplied JSON; "
        "do not calculate new metrics, invent item names, or imply causation. The general "
        "value must be at most two sentences. The states value must be an object mapping "
        "each supplied state name to one short sentence.\n\n"
        f"JSON:\n{json.dumps(payload, separators=(',', ':'))}"
    )
    try:
        response = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            params={"key": api_key},
            json={"contents": [{"parts": [{"text": prompt}]}]},
            timeout=30,
        )
        response.raise_for_status()
        text = response.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        bundle = json.loads(text.replace("```json", "").replace("```", "").strip())
        if not isinstance(bundle.get("general"), str) or not isinstance(bundle.get("states"), dict):
            raise ValueError("Invalid insight bundle")
        return {"general": bundle["general"], "states": bundle["states"]}, "gemini", model
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError):
        return fallback, "rule_based", None
