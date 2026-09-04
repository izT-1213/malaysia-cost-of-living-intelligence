# PriceLens technical methodology notes

These notes explain how PriceLens turns PriceCatcher observations into the
metrics shown in the dashboard. The Python pipeline is authoritative; the
browser only formats and filters already calculated summaries.

## Observed-day coverage

The latest-observation window is seven inclusive calendar dates ending at the
latest metric date available in PriceCatcher. PriceCatcher does not guarantee a
row on every calendar date, so this is an analytical window rather than a claim
that the source publishes daily. The
pipeline keeps the available dates and reports both the calendar window and
the distinct observed dates. A display of `6 observed days in a 7-calendar-day
window` is therefore incomplete operational coverage, not a seven-day
observation period. Complete-item coverage and state/premise coverage are
reported separately.

## Invalid and suspicious prices

Null, non-positive, malformed, or unmapped records are not valid metric input;
missing values are never converted to zero. Duplicate `(date, premise, item)`
records and robust-MAD extreme-price signals are reported for review by
`suspicious_observations`. There is no blanket statistical outlier deletion:
legitimate regional price differences are retained, and raw Parquet snapshots
remain preserved. The signal threshold is configurable and is an audit flag,
not an exclusion rule.

## Daily and monthly periods

The daily dashboard reads `daily_item_area_summary` and the canonical
`daily_basket_summary`. Monthly summaries are a separate view. A latest
complete-month fallback is selected only if the monthly view has no complete
latest month; it is not used by a successful daily view. The status banner
names the active period so fallback wording cannot be mistaken for the daily
metric source.

## Premise-to-state aggregation

The hierarchy is raw observation → item median → complete premise basket or
state basket → comparison summary. State baskets combine item coverage across
premises, while premise baskets require all components at the same premise;
incomplete premises are excluded. Premises are not silently treated as equal
to states, and the national reference is the median of complete state baskets,
not a mean of raw observations. A state can therefore be complete when no
single premise is complete.

## Metric populations and extrema

At item-area level, min, median, and max are calculated from the same filtered
period, geography, positive-price population, item code, and unit. For a basket,
component medians are summed. “Cheapest” and “most expensive” basket cards
compare those complete basket medians; item tables use explicit “lowest
observed”, “highest observed”, and “observed range” labels. Basket extrema are
component-wise bounds, not a claim that one premise simultaneously supplied
every component.

## Shared Dashboard and AI metric snapshot

The pipeline builds one validated `metric_contract` containing period, calendar
window, observed dates, item count, complete state/premise counts, and basket
median. Its deterministic SHA-256 `metric_snapshot_id` is stored with the
canonical basket rows and inside the AI analytical payload. The frontend shows
AI text only when the snapshot ID, metric date, and reference value match the
currently loaded daily contract; otherwise it withholds the explanation and
leaves structured metrics visible.

## Worked examples

For component medians `[RM 10.00, RM 12.00, RM 14.00]`, the item-area minimum,
median, and maximum are RM 10.00, RM 12.00, and RM 14.00. A ten-component
basket is the sum of its ten component medians, and a state comparison is the
median of complete state basket totals.

If premise A has eight components and premise B has the remaining two, the
state can be complete under the state rule while both premise baskets are
excluded. If one source row has price `0`, it is flagged as invalid and cannot
enter summaries; the raw source and its provenance hash remain available for
review. If the Dashboard carries snapshot `X` but AI carries snapshot `Y`, AI
text is withheld as stale rather than explained against a different window.

Known limitations: coverage varies by date, item, state, and premise; these
coverage measures are not statistical confidence intervals, and observed
prices are not guaranteed shelf prices or a CPI replacement.
