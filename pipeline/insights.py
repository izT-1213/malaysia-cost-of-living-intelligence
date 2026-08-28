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


REFERENCE_BASKET_RULES = [
    ("Rice", "BERAS", "10 kg", lambda name: name.startswith("BERAS ")),
    ("Standard chicken", "AYAM", "1kg", lambda name: "AYAM BERSIH" in name),
    ("Chicken eggs", "TELUR", "30 biji", lambda name: "TELUR AYAM GRED" in name),
    ("Cooking oil", "MINYAK DAN LEMAK", "1kg", lambda name: name.startswith("MINYAK MASAK")),
    ("Wheat flour", "TEPUNG", "1kg", lambda name: "TEPUNG GANDUM" in name),
    ("Yellow onions", "BAWANG", "1kg", lambda name: name.startswith("BAWANG BESAR")),
    ("Potatoes", "UBI KENTANG", "1kg", lambda name: True),
    ("Cabbage", "SAYUR-SAYURAN", "1kg", lambda name: name.startswith("KUBIS BULAT")),
    ("Tomato", "SAYUR-SAYURAN", "1kg", lambda name: name == "TOMATO"),
    ("Kangkung", "SAYUR-SAYURAN", "1kg", lambda name: name == "KANGKUNG"),
]


def build_daily_insight_payload(
    summary: pl.DataFrame, as_of: date, item_lookup: pl.DataFrame | None = None
) -> dict[str, Any]:
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
    payload = {
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
    if item_lookup is not None and latest.height:
        lookup = {
            int(row["item_code"]): row
            for row in item_lookup.select("item_code", "item", "unit", "item_category").to_dicts()
        }
        component_codes = {}
        for label, category, unit, name_rule in REFERENCE_BASKET_RULES:
            component_codes[label] = [
                code for code, row in lookup.items()
                if str(row["item_category"]) == category
                and str(row["unit"]).strip().lower() == unit.lower()
                and name_rule(str(row["item"]).upper())
            ]
        basket_rows = []
        for state in latest.get_column("state").unique().sort().to_list():
            state_frame = latest.filter(pl.col("state") == state)
            component_prices = {}
            for label, codes in component_codes.items():
                matches = state_frame.filter(pl.col("item_code").is_in(codes))
                if matches.height:
                    component_prices[label] = round(float(matches.get_column("median_price").median()), 2)
            if len(component_prices) == len(REFERENCE_BASKET_RULES):
                basket_rows.append({"state": state, "basket_median": round(sum(component_prices.values()), 2)})
        if basket_rows:
            payload["reference_basket"] = {
                "components": [label for label, *_ in REFERENCE_BASKET_RULES],
                "complete_states": len(basket_rows),
                "lowest": min(basket_rows, key=lambda row: (row["basket_median"], row["state"])),
                "highest": max(basket_rows, key=lambda row: (row["basket_median"], row["state"])),
            }
            payload["states"] = [
                {**row, **next((basket for basket in basket_rows if basket["state"] == row["state"]), {})}
                for row in payload["states"]
                if any(basket["state"] == row["state"] for basket in basket_rows)
            ]
    return payload


def fallback_explanation(payload: dict[str, Any]) -> str:
    """Provide useful copy when no external AI provider is configured."""
    basket = payload.get("reference_basket")
    if basket:
        lowest, highest = basket["lowest"], basket["highest"]
        return (
            f"For the {len(basket['components'])}-item reference basket, complete coverage is available in "
            f"{basket['complete_states']} states. The current state medians range from RM {lowest['basket_median']:.2f} "
            f"in {lowest['state']} to RM {highest['basket_median']:.2f} in {highest['state']}; these are calculated "
            "from PriceCatcher summaries, not generated by AI."
        )
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
    value_key = "basket_median" if all(row.get("basket_median") is not None for row in states) else "median_price"
    median = sum(float(row[value_key]) for row in states) / len(states)
    return {
        row["state"]: (
            f"{row['state']} has a complete reference-basket median of RM {row[value_key]:.2f}. "
            f"This is {'above' if row[value_key] >= median else 'below'} the cross-state basket median."
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
    model = os.getenv("GEMINI_MODEL", "gemini-3.6-flash").strip()
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
    model = os.getenv("GEMINI_MODEL", "gemini-3.6-flash").strip()
    fallback = {
        "general": fallback_explanation(payload),
        "states": fallback_state_explanations(payload),
    }
    if provider_name != "gemini" or not api_key:
        return fallback, "rule_based", None
    prompt = (
        "Return valid JSON only with keys general and states. Write a concise, factual "
        "insight for a Malaysian grocery-price dashboard, with a warm and practical tone "
        "that recognizes household grocery-shopping trade-offs without making stereotypes. "
        "Use only the supplied JSON; "
        "do not calculate new metrics, invent item names, or imply causation. The general "
        "value must be at most two sentences. The states value must be an object mapping "
        "each supplied state name to one short sentence.\n\n"
        f"JSON:\n{json.dumps(payload, separators=(',', ':'))}"
    )
    try:
        response = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            params={"key": api_key},
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"responseMimeType": "application/json", "temperature": 0.3},
            },
            timeout=30,
        )
        response.raise_for_status()
        text = response.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        cleaned = text.replace("```json", "").replace("```", "").strip()
        if not cleaned.startswith("{"):
            cleaned = cleaned[cleaned.find("{"):cleaned.rfind("}") + 1]
        bundle = json.loads(cleaned)
        if not isinstance(bundle.get("general"), str) or not isinstance(bundle.get("states"), dict):
            raise ValueError("Invalid insight bundle")
        return {"general": bundle["general"], "states": bundle["states"]}, "gemini", model
    except httpx.HTTPStatusError as error:
        print(f"Gemini insight request failed with HTTP {error.response.status_code}; using rule_based fallback.")
        return fallback, "rule_based", None
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as error:
        print(f"Gemini insight response was unusable ({type(error).__name__}); using rule_based fallback.")
        return fallback, "rule_based", None
