# Reference grocery basket

The dashboard's reference basket is a deterministic comparison tool, not an
official household expenditure basket or CPI replacement.

Each component is defined by an approved item category, name rule, and source
unit. For an area, comparable item-code variants matching a component are
combined using the median price for that component. Component prices are then
added together using one package of each source unit.

Current components:

| Component | Source definition |
| --- | --- |
| Rice | `BERAS`, 10 kg, rice item names |
| Standard chicken | `AYAM`, 1 kg, cleaned chicken items |
| Chicken eggs | `TELUR`, 30 eggs, Grade A/B/C chicken eggs |
| Cooking oil | `MINYAK DAN LEMAK`, 1 kg, cooking oil items |
| White sugar | `GULA`, 1 kg, white sugar items |
| Wheat flour | `TEPUNG`, 1 kg, wheat flour items |
| Fresh milk | `TERSEDIA MINUM`, 1 litre, fresh milk items |
| Yellow onions | `BAWANG`, 1 kg, large yellow onion items |
| Potatoes | `UBI KENTANG`, 1 kg, potato items |

An area is included in basket comparisons only when every component has at
least one matching observed item. Missing components are never treated as
zero and never silently replaced with a different unit or category.

The exact matching rules live in `frontend/app.js` as `basketRules`, while the
source item definitions come from the `item_lookup` table. Basket arithmetic
is performed in JavaScript only for display; the underlying item medians are
calculated by the deterministic Python pipeline.

The dashboard also provides a Custom basket view. Users can select any exact
item from `item_lookup`, assign a quantity, and add or remove components. A
custom basket uses the selected item codes directly and applies the same
complete-area rule as the reference basket.
