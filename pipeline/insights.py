"""Optional explanation boundary for structured analytical results."""

from __future__ import annotations

import os
import json
import time
from datetime import date, timedelta
from typing import Any, Protocol

import httpx
import polars as pl


GEMINI_REQUEST_TIMEOUT_SECONDS = 90.0
GEMINI_MAX_ATTEMPTS = 3
GEMINI_RETRY_DELAY_SECONDS = 2.0
GEMINI_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


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
    window_start = latest_date - timedelta(days=6) if latest_date else None
    latest = (
        state_rows.filter(pl.col("metric_date").is_between(window_start, latest_date, closed="both"))
        if latest_date else state_rows
    )
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
    item_lookup_map = {}
    if item_lookup is not None:
        item_lookup_map = {
            int(row["item_code"]): row
            for row in item_lookup.select("item_code", "item", "unit", "item_category").to_dicts()
        }
    state_median_reference = (
        float(state_stats.select(pl.col("median_price").median()).item()) if state_stats.height else None
    )
    state_rank = {
        row["state"]: rank
        for rank, row in enumerate(state_stats.sort(["median_price", "state"]).to_dicts(), start=1)
    }
    state_details = []
    for row in state_stats.to_dicts():
        state = row["state"]
        item_rows = (
            latest.filter(pl.col("state") == state)
            .group_by("item_code")
            .agg(pl.col("median_price").median().alias("median_price"))
            .sort(["median_price", "item_code"])
        )

        def named_item(item_row: dict[str, Any]) -> dict[str, Any]:
            code = int(item_row["item_code"])
            lookup_row = item_lookup_map.get(code, {})
            return {
                "item_code": code,
                "item": lookup_row.get("item", f"Item {code}"),
                "median_price": round(float(item_row["median_price"]), 2),
            }

        lowest_item = named_item(item_rows.row(0, named=True)) if item_rows.height else None
        highest_item = named_item(item_rows.row(-1, named=True)) if item_rows.height else None
        state_details.append({
            "state": state,
            "median_price": round(float(row["median_price"]), 2),
            "items_observed": int(row["items_observed"]),
            "rank_low_to_high": state_rank[state],
            "difference_from_state_median": (
                round(float(row["median_price"]) - state_median_reference, 2)
                if state_median_reference is not None else None
            ),
            "lowest_item": lowest_item,
            "highest_item": highest_item,
        })
    payload = {
        "as_of": as_of.isoformat(),
        "latest_metric_date": latest_date.isoformat() if latest_date else None,
        "states_observed": latest.select(pl.col("state").n_unique()).item() if latest.height else 0,
        "items_observed": item_stats.height,
        "state_median_reference": round(state_median_reference, 2) if state_median_reference is not None else None,
        "states": state_details,
        "highest_median_items": [
            {
                "item_code": int(row["item_code"]),
                "item": item_lookup_map.get(int(row["item_code"]), {}).get("item", f"Item {row['item_code']}"),
                "median_price": round(float(row["median_price"]), 2),
            }
            for row in item_stats.head(3).to_dicts()
        ],
        "lowest_median_items": [
            {
                "item_code": int(row["item_code"]),
                "item": item_lookup_map.get(int(row["item_code"]), {}).get("item", f"Item {row['item_code']}"),
                "median_price": round(float(row["median_price"]), 2),
            }
            for row in item_stats.tail(3).sort("median_price").to_dicts()
        ],
    }
    if item_lookup is not None and latest.height:
        lookup = item_lookup_map
        component_codes = {}
        for label, category, unit, name_rule in REFERENCE_BASKET_RULES:
            component_codes[label] = [
                code for code, row in lookup.items()
                if str(row["item_category"]) == category
                and str(row["unit"]).strip().lower() == unit.lower()
                and name_rule(str(row["item"]).upper())
            ]
        def basket_rows_for(frame: pl.DataFrame) -> list[dict[str, Any]]:
            rows = []
            if not frame.height:
                return rows
            for state in frame.get_column("state").unique().sort().to_list():
                state_frame = frame.filter(pl.col("state") == state)
                component_prices = {}
                for label, codes in component_codes.items():
                    matches = state_frame.filter(pl.col("item_code").is_in(codes))
                    if matches.height:
                        component_prices[label] = round(float(matches.get_column("median_price").median()), 2)
                if len(component_prices) == len(REFERENCE_BASKET_RULES):
                    cheapest_component = min(component_prices.items(), key=lambda entry: (entry[1], entry[0]))
                    priciest_component = max(component_prices.items(), key=lambda entry: (entry[1], entry[0]))
                    rows.append({
                        "state": state,
                        "basket_median": round(sum(component_prices.values()), 2),
                        "component_prices": component_prices,
                        "lowest_component": {"item": cheapest_component[0], "median_price": cheapest_component[1]},
                        "highest_component": {"item": priciest_component[0], "median_price": priciest_component[1]},
                    })
            return rows

        basket_rows = basket_rows_for(latest)
        if basket_rows:
            basket_reference = sum(row["basket_median"] for row in basket_rows) / len(basket_rows)
            previous_rows = basket_rows_for(
                state_rows.filter(
                    pl.col("metric_date").is_between(
                        window_start - timedelta(days=7), window_start - timedelta(days=1), closed="both"
                    )
                )
            )
            previous_by_state = {row["state"]: row["basket_median"] for row in previous_rows}
            payload["reference_basket"] = {
                "components": [label for label, *_ in REFERENCE_BASKET_RULES],
                "complete_states": len(basket_rows),
                "period": f"latest {min(7, latest.select(pl.col('metric_date').n_unique()).item())} days",
                "basket_median_reference": round(basket_reference, 2),
                "previous_period": "prior 7 days",
                "lowest": min(basket_rows, key=lambda row: (row["basket_median"], row["state"])),
                "highest": max(basket_rows, key=lambda row: (row["basket_median"], row["state"])),
            }
            payload["states"] = [
                {
                    **row,
                    **next((basket for basket in basket_rows if basket["state"] == row["state"]), {}),
                    "basket_difference_from_reference": next(
                        (
                            round(basket["basket_median"] - basket_reference, 2)
                            for basket in basket_rows
                            if basket["state"] == row["state"]
                        ),
                        None,
                    ),
                    "basket_change_7d": next(
                        (
                            round(basket["basket_median"] - previous_by_state[basket["state"]], 2)
                            for basket in basket_rows
                            if basket["state"] == row["state"] and basket["state"] in previous_by_state
                        ),
                        None,
                    ),
                }
                for row in payload["states"]
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
        response = _post_gemini_request(
            self.api_key,
            self.model,
            {"contents": [{"parts": [{"text": prompt}]}]},
        )
        response.raise_for_status()
        data = response.json()
        return data["candidates"][0]["content"]["parts"][0]["text"].strip()


def log_available_gemini_models(api_key: str) -> None:
    """Print safe model metadata when the configured model cannot be found."""
    try:
        response = httpx.get(
            "https://generativelanguage.googleapis.com/v1beta/models",
            params={"key": api_key},
            timeout=GEMINI_REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        models = response.json().get("models", [])
        supported = [
            {
                "name": model.get("name"),
                "methods": model.get("supportedGenerationMethods", []),
            }
            for model in models
            if "generateContent" in model.get("supportedGenerationMethods", [])
        ]
        print(f"Gemini models supporting generateContent: {json.dumps(supported, separators=(',', ':'))}")
    except (httpx.HTTPError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        print(f"Gemini model discovery failed ({type(error).__name__}); using rule_based fallback.")


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


def _post_gemini_request(api_key: str, model: str, request_body: dict[str, Any]) -> httpx.Response:
    """Call Gemini with bounded retries for timeouts and transient API errors."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    last_error: Exception | None = None
    for attempt in range(1, GEMINI_MAX_ATTEMPTS + 1):
        try:
            response = httpx.post(
                url,
                params={"key": api_key},
                json=request_body,
                timeout=GEMINI_REQUEST_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            if attempt > 1:
                print(f"Gemini request succeeded on retry {attempt}/{GEMINI_MAX_ATTEMPTS}.")
            return response
        except httpx.HTTPStatusError as error:
            status_code = error.response.status_code
            if status_code not in GEMINI_RETRYABLE_STATUS_CODES:
                raise
            last_error = error
            print(f"Gemini request attempt {attempt}/{GEMINI_MAX_ATTEMPTS} returned HTTP {status_code}.")
        except (httpx.TimeoutException, httpx.NetworkError) as error:
            last_error = error
            print(
                f"Gemini request attempt {attempt}/{GEMINI_MAX_ATTEMPTS} failed with "
                f"{type(error).__name__}."
            )
        if attempt < GEMINI_MAX_ATTEMPTS:
            time.sleep(GEMINI_RETRY_DELAY_SECONDS * attempt)
    assert last_error is not None
    raise last_error


def generate_insight_bundle(
    payload: dict[str, Any],
) -> tuple[dict[str, Any], str, str | None, str | None]:
    """Return notes, provider metadata, and an optional fallback reason."""
    provider_name = os.getenv("AI_PROVIDER", "disabled").strip().lower()
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    model = os.getenv("GEMINI_MODEL", "gemini-3.6-flash").strip()
    fallback = {
        "general": fallback_explanation(payload),
        "states": fallback_state_explanations(payload),
    }
    if provider_name != "gemini" or not api_key:
        return fallback, "rule_based", None, "gemini_not_configured"
    prompt = (
        "Return valid JSON only with keys general and states. Write a concise, factual "
        "insight for a Malaysian grocery-price dashboard, with a warm and practical tone "
        "that recognizes household grocery-shopping trade-offs without making stereotypes. "
        "Use only the supplied JSON; do not calculate new metrics, invent item names, "
        "mention item codes, or imply causation. The general value should be at most two "
        "sentences. Prefer complete reference-basket metrics when available: explain the "
        "state's basket position, distance from the cross-state basket reference, and "
        "the supplied highest or lowest basket component. If basket_change_7d is present, "
        "say whether the basket rose or fell over the prior seven-day period. Each state value should be one "
        "or two human, analytical sentences: say what stands out, not merely what the "
        "numbers are. If a state lacks complete basket coverage, say so briefly and use "
        "the tracked-item median only as a qualified fallback. Always write monetary values "
        "with the RM prefix and two decimal places; RM is Malaysian ringgit (MYR). Write "
        "percentage changes with the % sign, and label counts as observations, items, or "
        "states. Never leave a bare number whose unit could be unclear.\n\n"
        f"JSON:\n{json.dumps(payload, separators=(',', ':'))}"
    )
    try:
        response = _post_gemini_request(
            api_key,
            model,
            {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"responseMimeType": "application/json", "temperature": 0.3},
            },
        )
        response.raise_for_status()
        text = response.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        cleaned = text.replace("```json", "").replace("```", "").strip()
        if not cleaned.startswith("{"):
            cleaned = cleaned[cleaned.find("{"):cleaned.rfind("}") + 1]
        bundle = json.loads(cleaned)
        if not isinstance(bundle.get("general"), str) or not isinstance(bundle.get("states"), dict):
            raise ValueError("Invalid insight bundle")
        return {"general": bundle["general"], "states": bundle["states"]}, "gemini", model, None
    except httpx.HTTPStatusError as error:
        print(f"Gemini insight request failed with HTTP {error.response.status_code}; using rule_based fallback.")
        if error.response.status_code == 404:
            log_available_gemini_models(api_key)
        return fallback, "rule_based", None, f"http_{error.response.status_code}"
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as error:
        print(
            f"Gemini insight failed after {GEMINI_MAX_ATTEMPTS} attempt(s) "
            f"({type(error).__name__}); using rule_based fallback."
        )
        return fallback, "rule_based", None, type(error).__name__
