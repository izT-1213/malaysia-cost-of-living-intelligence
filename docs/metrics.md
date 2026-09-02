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

## Reference basket contract

The Dashboard and stored AI evidence use the same reference-basket definition:

- Window: seven inclusive calendar days ending on the latest available metric date. The interface reports both the calendar range and the number of observed days.
- Component value: median of the daily item-area summary medians within that window, using the official item code and matched unit for each basket component.
- Area eligibility: an area is included only when all ten reference-basket components are present in the window. Missing items never contribute zero.
- Grain distinction: state-level baskets may combine observations across premises, while premise-level baskets require all ten components at the same premise within the window.
- Basket value: the unweighted sum of the ten component medians. Quantities are one official pack/unit each.
- Cross-state reference: the median of complete state basket values, not the mean.
- Monthly view: the same component and complete-area rules applied to the selected calendar month; it is not mixed with the daily window.

AI text receives these structured values as input and may explain them, but it does not recalculate or override them.

Metrics must show period, geography, filters, sample size, and missing-data caveats in the API response or dashboard.
