# Metric definitions

All metrics are calculated by code from validated observations. Definitions below are initial contracts and should be versioned when changed.

| Metric | Definition |
|---|---|
| Median item price | Median observed price for an item in a selected period and geography. |
| Price change | `(current_period_value / comparison_period_value - 1) * 100`; comparison values use the same aggregation and filters. |
| Volatility | Standard deviation of an item's time-series percentage changes over the selected lookback. |
| Percentile | Empirical percentile of observations within the selected comparison set. |
| Basket change | Percentage change in the weighted sum of item prices; weights are explicit and versioned. |
| Contribution | An item's change in weighted basket cost divided by total basket change, expressed in percentage points where defined. |
| Anomaly | Observation outside configured historical bounds; the initial foundation uses a robust median/MAD z-score. |

Metrics must show period, geography, filters, sample size, and missing-data caveats in the API response or dashboard.
