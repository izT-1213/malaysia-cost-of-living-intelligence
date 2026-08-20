"""Optional explanation boundary for structured analytical results."""

from __future__ import annotations

from typing import Any, Protocol


class InsightProvider(Protocol):
    def explain(self, payload: dict[str, Any]) -> str: ...


class DisabledInsightProvider:
    """Safe default: the product works without an AI provider."""

    def explain(self, payload: dict[str, Any]) -> str:
        del payload
        return ""
