const demoObservations = [
  { state: "Selangor", item: "Eggs", median: 12.4, min: 8.9, max: 16.8 },
  { state: "Johor", item: "Eggs", median: 11.8, min: 9.2, max: 15.5 },
  { state: "Pulau Pinang", item: "Eggs", median: 13.2, min: 10.0, max: 17.1 },
  { state: "Kedah", item: "Eggs", median: 10.9, min: 8.8, max: 14.0 },
  { state: "Perak", item: "Eggs", median: 11.5, min: 9.0, max: 15.0 },
  { state: "Sarawak", item: "Eggs", median: 14.1, min: 11.5, max: 18.2 },
  { state: "Sabah", item: "Eggs", median: 14.8, min: 12.0, max: 19.2 },
  { state: "Negeri Sembilan", item: "Eggs", median: 12.1, min: 9.5, max: 15.8 },
];
const DAILY_WINDOW_DAYS = 7;
const MONTHLY_HISTORY_MONTHS = 6;

let observations = [];
const datasets = { daily: [], monthly: [] };
let monthlyHistory = [];
let supabaseLoaded = false;
let dataStatus = "loading";
let loadPromise = null;
let activeLoadController = null;
let lastSuccessfulDate = localStorage.getItem("pricelens-last-successful-date") || "";
let districts = {
  Selangor: ["Petaling", "Gombak", "Klang"], Johor: ["Johor Bahru", "Batu Pahat"],
  "Pulau Pinang": ["Timur Laut", "Seberang Perai Tengah"], Kedah: ["Kota Setar", "Sungai Petani"],
  Perak: ["Kinta", "Manjung"], Sarawak: ["Kuching", "Miri"], Sabah: ["Kota Kinabalu", "Sandakan"],
  "Negeri Sembilan": ["Seremban", "Port Dickson"],
};

const trend = [11.7, 12.1, 12.0, 12.6, 12.3, 12.8, 12.4];
const money = (value) => `RM ${value.toFixed(2)}`;
// Keep frontend totals aligned with Python's two-decimal metric rounding.
const roundCurrency = (value) => Number(value.toFixed(2));
const config = window.PRICE_LENS_CONFIG || {};

// Components are resolved from approved category/name/unit rules. Similar
// variants may contribute, but incompatible pack sizes never get mixed.
const basketRules = [
  { label: "Rice", category: "BERAS", unit: "10 kg", name: (value) => value.startsWith("BERAS ") },
  { label: "Standard chicken", category: "AYAM", unit: "1kg", name: (value) => value.includes("AYAM BERSIH") },
  { label: "Chicken eggs", category: "TELUR", unit: "30 biji", name: (value) => value.includes("TELUR AYAM GRED") },
  { label: "Cooking oil", category: "MINYAK DAN LEMAK", unit: "1kg", name: (value) => value.startsWith("MINYAK MASAK") },
  { label: "Wheat flour", category: "TEPUNG", unit: "1kg", name: (value) => value.includes("TEPUNG GANDUM") },
  { label: "Yellow onions", category: "BAWANG", unit: "1kg", name: (value) => value.startsWith("BAWANG BESAR") },
  { label: "Potatoes", category: "UBI KENTANG", unit: "1kg", name: () => true },
  { label: "Cabbage", category: "SAYUR-SAYURAN", unit: "1kg", name: (value) => value.startsWith("KUBIS BULAT") },
  { label: "Tomato", category: "SAYUR-SAYURAN", unit: "1kg", name: (value) => value === "TOMATO" },
  { label: "Kangkung", category: "SAYUR-SAYURAN", unit: "1kg", name: (value) => value === "KANGKUNG" },
];
let basketComponents = [];

const stateFilter = document.querySelector("#state-filter");
const districtFilter = document.querySelector("#district-filter");
const itemFilter = document.querySelector("#item-filter");
const viewFilter = document.querySelector("#view-filter");
const table = document.querySelector("#state-table");
itemFilter.disabled = true;
const customBasketPanel = document.querySelector("#custom-basket");
const customCategory = document.querySelector("#custom-category");
const customItemSearch = document.querySelector("#custom-item-search");
const customItem = document.querySelector("#custom-item");
const customQuantity = document.querySelector("#custom-quantity");
const customBasketList = document.querySelector("#custom-basket-list");
const customStateFilter = document.querySelector("#custom-state-filter");
const customDistrictFilter = document.querySelector("#custom-district-filter");
let availableItems = [];
let customBasket = [];
let premiseLookup = [];
let premiseObservations = [];
let premiseDataLoaded = false;
let premiseDataLoading = false;
let canonicalDailyBasketRows = [];
let dailyDateForPremise = "";
let dailyStartDateForPremise = "";
let aiInsightBundle = { general: "", states: {} };
let aiInsightStatus = "not loaded";
let aiLoadPromise = null;
let monthlyFallback = false;
let monthlyDisplayDate = "";

function insightStateRecord(state) {
  return Array.isArray(aiInsightBundle.states)
    ? aiInsightBundle.states.find((row) => row.state === state)
    : null;
}

function coverageLabel(items, total, days) {
  if (!items || !total) return "Coverage unavailable";
  if (items < total) return "Partial basket";
  if (days < 3) return "Limited coverage";
  if (days < 7) return "Good coverage · fewer than 7 days";
  return "Strong coverage";
}

function renderAiGeneralFacts() {
  const target = document.querySelector("#ai-general-facts");
  const basket = aiInsightBundle.reference_basket;
  if (!target) return;
  const stateCount = new Set(datasets.daily.filter((row) => row.areaLevel === "state").map((row) => row.state)).size;
  const itemCount = basket?.components?.length || basketComponents.length || aiInsightBundle.items_observed || 0;
  const dayCount = new Set(datasets.daily.map((row) => row.metricDate).filter(Boolean)).size;
  const premiseCount = premiseDataLoaded ? new Set(premiseObservations.map((row) => String(row.premiseCode))).size : "Not loaded";
  if (!basket && !stateCount) {
    target.innerHTML = '<p class="chart-empty">Evidence details will appear when current live metrics are available.</p>';
    return;
  }
  const lowCoverage = basket?.complete_baskets_with_fewer_than_7_days
    || basket?.complete_baskets_with_fewer_than_14_days
    || [];
  const limitedDays = dayCount > 0 && dayCount < DAILY_WINDOW_DAYS;
  const lowCoverageCopy = lowCoverage.length
    ? `${lowCoverage.length} state${lowCoverage.length === 1 ? "" : "s"} use fewer than 7 observed days`
    : limitedDays ? `${dayCount} of ${DAILY_WINDOW_DAYS} calendar days are observed in the current window` : "All complete states use 7 observed days";
  target.innerHTML = [
    ["States", basket?.complete_states ?? stateCount, "Complete reference-basket states"],
    ["Premises", premiseCount, premiseDataLoaded ? "Loaded premise observations" : "Loaded when a state is selected"],
    ["Items", itemCount, "Reference components in scope"],
    ["Observed days", dayCount || "—", basket?.period || "Current metric window"],
    ["Basket reference", basket ? money(Number(basket.basket_median_reference)) : "—", "Median across complete states"],
    ["Coverage quality", lowCoverage.length || limitedDays ? "Limited" : "Available", lowCoverageCopy],
  ].map(([label, value, caption]) => `<article class="ai-fact"><span class="metric-label">${label}</span><strong>${value}</strong><small>${caption}</small></article>`).join("");
}

function renderStateDetailFacts(record) {
  const facts = document.querySelector("#state-detail-facts");
  const breakdown = document.querySelector("#state-component-breakdown");
  if (!facts || !breakdown) return;
  if (!record) {
    facts.innerHTML = "";
    breakdown.innerHTML = "";
    return;
  }
  const items = record.reference_basket_items_observed;
  const total = record.reference_basket_items_total;
  const days = record.reference_basket_days_observed;
  const change = record.basket_change_7d;
  facts.innerHTML = [
    ["Coverage", `${items ?? "—"}/${total ?? "—"} items`, `${days ?? "—"}/7 observed days`],
    ["Confidence", coverageLabel(items, total, days), "Interpretation guide"],
    ["Seven-day change", change == null ? "—" : `${change >= 0 ? "+" : ""}${money(change)}`, "RM vs prior window"],
    ["Basket position", record.basket_difference_from_reference == null ? "—" : `${record.basket_difference_from_reference >= 0 ? "+" : ""}${money(record.basket_difference_from_reference)}`, "Against cross-state reference"],
  ].map(([label, value, caption]) => `<article class="ai-fact"><span class="metric-label">${label}</span><strong>${value}</strong><small>${caption}</small></article>`).join("");
  const components = Object.entries(record.component_prices || {}).sort((a, b) => b[1] - a[1]);
  breakdown.innerHTML = components.length
    ? `<div class="subchart-heading"><p class="eyebrow">Basket composition</p><span>Component medians · RM</span></div>${components.map(([label, value]) => `<div class="bar-row"><span class="bar-label">${label}</span><div class="bar-track"><i style="width:${(value / Math.max(...components.map((entry) => entry[1]))) * 100}%"></i></div><strong>${money(Number(value))}</strong></div>`).join("")}`
    : "";
}

function replaceOptions(select, values) {
  const first = select.querySelector("option").cloneNode(true);
  select.replaceChildren(first);
  [...new Set(values)].filter(Boolean).sort().forEach((value) => {
    select.insertAdjacentHTML("beforeend", `<option value="${value}">${value}</option>`);
  });
}

function formatMetricDate(value) {
  if (!value) return "Waiting for live data";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function setDataStatus(status, message, { retry = false } = {}) {
  dataStatus = status;
  const banner = document.querySelector("#data-status");
  const messageTarget = document.querySelector("#data-status-message");
  const retryButton = document.querySelector("#retry-data");
  if (!banner || !messageTarget || !retryButton) return;
  banner.dataset.status = status;
  banner.setAttribute("aria-busy", status === "loading" ? "true" : "false");
  messageTarget.textContent = message;
  retryButton.hidden = !retry;
}

function lastSuccessfulCopy() {
  return lastSuccessfulDate
    ? ` Last successful data date: ${formatMetricDate(lastSuccessfulDate)}.`
    : " No successful live data load has been recorded in this browser yet.";
}

function latestWindowRows(rows, days = DAILY_WINDOW_DAYS) {
  if (!rows.length) return [];
  const latestDate = rows.reduce((latest, row) => row.metricDate > latest ? row.metricDate : latest, "");
  const start = new Date(`${latestDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const startDate = start.toISOString().slice(0, 10);
  return rows.filter((row) => row.metricDate >= startDate && row.metricDate <= latestDate);
}

function metricWindowLabel(period = document.querySelector("#period-filter")?.value || "daily") {
  const source = period === "monthly" ? datasets.monthly : datasets.daily;
  const dates = [...new Set(source.map((row) => row.metricDate).filter(Boolean))].sort();
  if (!dates.length) return period === "monthly" ? "Selected month" : "Latest 7 calendar days";
  if (period === "monthly") return formatMetricDate(dates[dates.length - 1]);
  const start = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (DAILY_WINDOW_DAYS - 1));
  return `${formatMetricDate(start.toISOString().slice(0, 10))} – ${formatMetricDate(dates[dates.length - 1])}`;
}

function structuredReferenceBasketValue(rows) {
  if (canonicalDailyBasketRows.length) {
    const storedReference = Number(canonicalDailyBasketRows[0].cross_state_reference);
    return Number.isFinite(storedReference)
      ? storedReference
      : roundCurrency(medianOf(canonicalDailyBasketRows.map((row) => Number(row.basket_median))));
  }
  const stateRows = rows.filter((row) => row.areaLevel === "state");
  const baskets = [...new Set(stateRows.map((row) => row.state))].map((state) => {
    const windowRows = latestWindowRows(stateRows.filter((row) => row.state === state));
    const components = basketComponents.map((component) => {
      const matches = component.itemCodes.flatMap((code) => windowRows.filter((row) => String(row.itemCode) === String(code)));
      return matches.length ? roundCurrency(medianOf(matches.map((row) => row.median))) : null;
    });
    return components.every((value) => value !== null)
      ? roundCurrency(components.reduce((sum, value) => sum + value, 0))
      : null;
  }).filter((value) => value !== null);
  return baskets.length ? roundCurrency(medianOf(baskets)) : null;
}

function monthlyCompleteStateRows(rows) {
  const states = [...new Set(rows.filter((row) => row.areaLevel === "state").map((row) => row.state))];
  return states.map((state) => {
    const stateRows = rows.filter((row) => row.areaLevel === "state" && row.state === state);
    const components = basketComponents.map((component) => {
      const matches = component.itemCodes.flatMap((code) => stateRows.filter((row) => String(row.itemCode) === String(code)));
      return matches.length ? medianOf(matches.map((row) => row.median)) : null;
    });
    return components.every((value) => value !== null)
      ? { state, median: components.reduce((sum, value) => sum + value, 0) }
      : null;
  }).filter(Boolean);
}

function renderAboutQuality() {
  const target = document.querySelector("#about-quality-list");
  const freshness = document.querySelector("#about-freshness");
  if (!target || !datasets.daily.length) return;
  const stateRows = datasets.daily.filter((row) => row.areaLevel === "state");
  const states = [...new Set(stateRows.map((row) => row.state))];
  const completeStates = states.filter((state) => {
    const rows = latestWindowRows(stateRows.filter((row) => row.state === state));
    return basketComponents.every((component) => component.itemCodes.some((code) => rows.some((row) => String(row.itemCode) === String(code))));
  }).length;
  const days = new Set(stateRows.map((row) => row.metricDate)).size;
  const premises = premiseDataLoaded ? new Set(premiseObservations.map((row) => String(row.premiseCode))).size : "Loaded on AI or basket comparison";
  target.innerHTML = [
    ["Observed days", `${days}/7`, "Current daily window"],
    ["Complete states", `${completeStates}/${states.length}`, "All 10 items available"],
    ["Premises", premises, "Loaded premise detail"],
  ].map(([label, value, caption]) => `<span><strong>${value}</strong><small>${label} · ${caption}</small></span>`).join("");
  if (freshness) freshness.textContent = `Latest metric date: ${metricWindowLabel("daily").split(" – ").pop()}. Known limitations: coverage varies by place and day; prices are observed medians, not guaranteed store prices or a replacement for CPI.`;
}

function stateRowsForInsight() {
  const rows = datasets.daily.filter((row) => row.areaLevel === "state");
  const latest = rows.reduce((value, row) => row.metricDate > value ? row.metricDate : value, "");
  return rows.filter((row) => row.metricDate === latest);
}

function showStateInsight(state) {
  const rows = stateRowsForInsight().filter((row) => row.state === state);
  const record = insightStateRecord(state);
  const storedValue = record?.basket_median;
  const median = storedValue ?? (rows.length ? medianOf(rows.map((row) => row.median)) : null);
  document.querySelector("#state-detail-name").textContent = state || "Select a state";
  document.querySelector("#state-detail-value").textContent = median === null ? "—" : money(median);
  document.querySelector("#state-detail-copy").textContent = aiInsightBundle.state_insights?.[state] || aiInsightBundle.states?.[state] || "No stored state insight is available for this selection yet.";
  renderStateDetailFacts(record);
  document.querySelectorAll(".map-state").forEach((button) => button.classList.toggle("selected", button.dataset.state === state));
  renderStatePremiseAnalysis(state);
}

function statePremiseBasketRows(state) {
  if (!state || !premiseObservations.length || !basketComponents.length) return [];
  const stateRows = premiseObservations.filter((row) => row.state === state);
  const grouped = new Map();
  stateRows.forEach((row) => {
    const area = grouped.get(String(row.premiseCode)) || {
      premiseCode: row.premiseCode,
      premise: row.premise,
      district: row.district,
      components: new Map(),
    };
    const rows = area.components.get(String(row.itemCode)) || [];
    rows.push(row);
    area.components.set(String(row.itemCode), rows);
    grouped.set(String(row.premiseCode), area);
  });
  return [...grouped.values()].map((area) => {
    const windowedRows = latestWindowRows([...area.components.values()].flat());
    const componentRows = basketComponents.map((component) => {
      const matches = component.itemCodes.flatMap((code) => windowedRows.filter((row) => String(row.itemCode) === String(code)));
      return matches.length ? medianRow(matches) : null;
    });
    if (componentRows.some((row) => !row)) return null;
    return {
      ...area,
      median: roundCurrency(componentRows.reduce((sum, row) => sum + row.median, 0)),
      componentCount: componentRows.length,
    };
  }).filter(Boolean).sort((a, b) => a.median - b.median || String(a.premise).localeCompare(String(b.premise)));
}

function renderStatePremiseAnalysis(state) {
  const copy = document.querySelector("#premise-analysis-copy");
  const grid = document.querySelector("#premise-analysis-grid");
  const chart = document.querySelector("#premise-analysis-chart");
  const trend = document.querySelector("#premise-analysis-trend");
  const tableBody = document.querySelector("#premise-analysis-table");
  if (!copy || !grid || !chart || !trend || !tableBody) return;
  if (!supabaseLoaded) {
    copy.textContent = "Premise analysis will appear when live Supabase data is connected.";
    grid.innerHTML = "";
    chart.innerHTML = "";
    trend.innerHTML = "";
    tableBody.innerHTML = "";
    return;
  }
  if (premiseDataLoading) {
    copy.textContent = "Loading complete reference baskets across premises…";
    grid.innerHTML = "";
    chart.innerHTML = "";
    trend.innerHTML = "";
    tableBody.innerHTML = "";
    return;
  }
  const rows = statePremiseBasketRows(state);
  if (!premiseDataLoaded) {
    copy.textContent = "Premise analysis is loading for this state…";
    grid.innerHTML = "";
    chart.innerHTML = "";
    trend.innerHTML = "";
    tableBody.innerHTML = "";
    return;
  }
  if (!rows.length) {
    copy.textContent = `No single premise in ${state} has all 10 reference-basket components in the latest 7-day window. The state-level basket may still be complete because it combines coverage across multiple premises.`;
    grid.innerHTML = "";
    chart.innerHTML = "";
    trend.innerHTML = "";
    tableBody.innerHTML = "";
    return;
  }
  const cheapest = rows[0];
  const expensive = rows[rows.length - 1];
  const median = medianOf(rows.map((row) => row.median));
  copy.textContent = `${rows.length} premises in ${state} have complete coverage. Results use the median price of each basket component at the same premise; incomplete premises are excluded.`;
  grid.innerHTML = [
    ["Complete premises", rows.length, "Reference basket coverage"],
    ["Typical basket", money(median), "Median across premises"],
    ["Lowest complete basket", money(cheapest.median), cheapest.premise || `Premise ${cheapest.premiseCode}`],
    ["Highest complete basket", money(expensive.median), expensive.premise || `Premise ${expensive.premiseCode}`],
  ].map(([label, value, caption]) => `<article class="metric-card"><span class="metric-label">${label}</span><strong>${value}</strong><span class="metric-caption">${caption}</span></article>`).join("");
  const max = Math.max(...rows.map((row) => row.median));
  chart.innerHTML = `<div class="subchart-heading"><p class="eyebrow">Premise ranking</p><span>Top 10 complete baskets · RM</span></div>${rows.slice(0, 10).map((row) => `
    <div class="bar-row"><span class="bar-label">${row.premise || `Premise ${row.premiseCode}`}</span><div class="bar-track"><i style="width:${(row.median / max) * 100}%"></i></div><strong>${money(row.median)}</strong></div>`).join("")}`;
  const trendRows = stateBasketTrendRows(state);
  const trendMax = trendRows.length ? Math.max(...trendRows.map((row) => row.median)) : 0;
  trend.innerHTML = `<div class="subchart-heading"><p class="eyebrow">Seven-day movement</p><span>Complete basket median · RM</span></div>${trendRows.length ? `<div class="mini-trend">${trendRows.map((row) => `<div class="mini-trend-column"><strong>${money(row.median)}</strong><i style="height:${(row.median / trendMax) * 100}%"></i><small>${row.date.slice(5)}</small></div>`).join("")}</div>` : '<p class="chart-empty">Not enough complete daily baskets for a trend.</p>'}`;
  tableBody.innerHTML = rows.slice(0, 10).map((row) => `<tr><th scope="row">${row.premise || `Premise ${row.premiseCode}`}</th><td>${row.district || "—"}</td><td>${money(row.median)}</td></tr>`).join("");
}

function stateBasketTrendRows(state) {
  const rows = datasets.daily.filter((row) => row.areaLevel === "state" && row.state === state);
  return [...new Set(rows.map((row) => row.metricDate))].sort().map((metricDate) => {
    const dayRows = rows.filter((row) => row.metricDate === metricDate);
    const componentRows = basketComponents.map((component) => {
      const matches = dayRows.filter((row) => component.itemCodes.includes(row.itemCode));
      return matches.length ? roundCurrency(medianOf(matches.map((row) => row.median))) : null;
    });
    return componentRows.some((value) => value === null) ? null : {
      date: metricDate,
      median: roundCurrency(componentRows.reduce((sum, value) => sum + value, 0)),
    };
  }).filter(Boolean);
}

function renderInsightMap() {
  const map = document.querySelector("#state-map");
  if (!map) return;
  const states = [...new Set(stateRowsForInsight().map((row) => row.state).filter(Boolean))].sort();
  map.innerHTML = states.length
    ? states.map((state) => `<button class="map-state" type="button" data-state="${state}" title="View ${state} insight">${state}</button>`).join("")
    : '<p class="ai-map-empty">No state summaries are available yet.</p>';
  map.querySelectorAll(".map-state").forEach((button) => button.addEventListener("click", () => showStateInsight(button.dataset.state)));
  if (states.length) showStateInsight(states[0]);
}

function renderCustomBuilder() {
  customBasketList.innerHTML = customBasket.length
    ? `<div class="custom-basket-table-wrap"><table class="custom-basket-table"><thead><tr><th>Item</th><th>Unit</th><th>Quantity</th><th>Official code</th><th></th></tr></thead><tbody>${customBasket.map((entry, index) => `<tr><th scope="row">${entry.item}</th><td>${entry.unit}</td><td>${entry.quantity}</td><td>${entry.itemCode}</td><td><button type="button" data-remove-basket-index="${index}" aria-label="Remove ${entry.item}">Remove</button></td></tr>`).join("")}</tbody></table></div>`
    : "<span>No items added yet.</span>";
  customBasketList.querySelectorAll("[data-remove-basket-index]").forEach((button) => {
    button.addEventListener("click", () => {
      customBasket.splice(Number(button.dataset.removeBasketIndex), 1);
      renderCustomBuilder();
      render();
    });
  });
}

function populateCustomItemOptions() {
  const category = customCategory.value;
  const query = customItemSearch.value.trim().toLowerCase();
  const filtered = availableCustomItems().filter((item) =>
    (category === "all" || item.item_category === category)
    && (!query || item.item.toLowerCase().includes(query))
  );
  customItem.replaceChildren(new Option("Choose an item", ""));
  filtered.sort((a, b) => a.item.localeCompare(b.item)).forEach((item) => {
    customItem.add(new Option(`${item.item} · ${item.unit}`, String(item.item_code)));
  });
}

function missingCustomItems() {
  if (!customBasket.length || !premiseObservations.length) return [];
  const selectedRows = premiseObservations.filter((row) =>
    (customStateFilter.value === "all" || row.state === customStateFilter.value)
    && (customDistrictFilter.value === "all" || row.district === customDistrictFilter.value)
  );
  const observedCodes = new Set(selectedRows.map((row) => String(row.itemCode)));
  return customBasket.filter((item) => !observedCodes.has(String(item.itemCode)));
}

function availableCustomItems() {
  const observedCodes = new Set(observations.map((row) => String(row.itemCode)).filter(Boolean));
  return supabaseLoaded && observedCodes.size
    ? availableItems.filter((item) => observedCodes.has(String(item.item_code)))
    : availableItems;
}

function populateCustomLocationFilters() {
  const locations = premiseDataLoaded
    ? premiseLookup.filter((premise) => premiseObservations.some((row) => String(row.premiseCode) === String(premise.premise_code)))
    : observations.filter((row) => row.state && row.district).map((row) => ({ state: row.state, district: row.district }));
  const selectedState = customStateFilter.value;
  const selectedDistrict = customDistrictFilter.value;
  replaceOptions(customStateFilter, locations.map((row) => row.state));
  customStateFilter.value = locations.some((row) => row.state === selectedState) ? selectedState : "all";
  const districtsForState = locations.filter((row) => customStateFilter.value === "all" || row.state === customStateFilter.value).map((row) => row.district);
  replaceOptions(customDistrictFilter, districtsForState);
  customDistrictFilter.value = districtsForState.includes(selectedDistrict) ? selectedDistrict : "all";
}

function populateFilters() {
  const selectedItem = itemFilter.value;
  const selectedState = stateFilter.value;
  const selectedDistrict = districtFilter.value;
  const itemValues = observations.map((row) => row.item);
  replaceOptions(itemFilter, itemValues);
  itemFilter.value = itemValues.includes(selectedItem) ? selectedItem : "all";

  const itemRows = itemFilter.value === "all" ? observations : observations.filter((row) => row.item === itemFilter.value);
  const stateRows = itemRows.filter((row) => !row.areaLevel || row.areaLevel === "state");
  const stateValues = stateRows.map((row) => row.state);
  replaceOptions(stateFilter, stateValues);
  stateFilter.value = stateValues.includes(selectedState) ? selectedState : "all";

  const districtRows = itemRows.filter((row) => (!row.areaLevel || row.areaLevel === "district") && (stateFilter.value === "all" || row.state === stateFilter.value));
  const districtValues = districtRows.some((row) => row.district)
    ? districtRows.map((row) => row.district)
    : (stateFilter.value === "all" ? Object.values(districts).flat() : districts[stateFilter.value] || []);
  replaceOptions(districtFilter, districtValues);
  districtFilter.value = districtValues.includes(selectedDistrict) ? selectedDistrict : "all";
}

function selectedRows() {
  if (viewFilter.value === "basket") return selectedBasketRows();
  return observations.filter((row) => {
    const stateMatches = stateFilter.value === "all" || row.state === stateFilter.value;
    const itemMatches = itemFilter.value === "all" || row.item === itemFilter.value;
    const districtMatches = districtFilter.value === "all" || row.district === districtFilter.value;
    const levelMatches = !row.areaLevel || row.areaLevel === (districtFilter.value === "all" ? "state" : "district");
    return stateMatches && itemMatches && districtMatches && levelMatches;
  });
}

function selectedBasketRows() {
  const components = viewFilter.value === "custom"
    ? customBasket.map((item) => ({ ...item, itemCodes: [item.itemCode] }))
    : basketComponents;
  if (!components.length) return [];
  const level = districtFilter.value === "all" ? "state" : "district";
  if (viewFilter.value === "basket" && document.querySelector("#period-filter").value === "daily"
    && level === "state" && canonicalDailyBasketRows.length) {
    return canonicalDailyBasketRows.filter((row) => stateFilter.value === "all" || row.state === stateFilter.value)
      .map((row) => ({
        state: row.state,
        district: "",
        areaLevel: "state",
        item: "Reference grocery basket",
        itemCode: null,
        median: Number(row.basket_median),
        min: Number(row.basket_median),
        max: Number(row.basket_median),
        coverage: row.reference_basket_items_total ? row.reference_basket_items_observed / row.reference_basket_items_total : 0,
        complete: true,
      }));
  }
  const candidates = observations.filter((row) => {
    if (row.areaLevel && row.areaLevel !== level) return false;
    if (stateFilter.value !== "all" && row.state !== stateFilter.value) return false;
    if (districtFilter.value !== "all" && row.district !== districtFilter.value) return false;
    return true;
  });
  const windowedCandidates = document.querySelector("#period-filter").value === "daily"
    ? latestWindowRows(candidates)
    : candidates;
  const grouped = new Map();
  windowedCandidates.forEach((row) => {
    const key = `${row.state}|${row.district}`;
    const area = grouped.get(key) || { state: row.state, district: row.district, components: new Map() };
    const itemRows = area.components.get(String(row.itemCode)) || [];
    itemRows.push(row);
    area.components.set(String(row.itemCode), itemRows);
    grouped.set(key, area);
  });
  return [...grouped.values()].map((area) => {
    const present = components.map((component) => {
      const matches = component.itemCodes.flatMap((code) => area.components.get(String(code)) || []);
      return matches.length ? { ...component, row: medianRow(matches) } : null;
    }).filter(Boolean);
    const values = (field) => present.reduce((sum, component) => sum + component.row[field], 0);
    const coverage = present.length / components.length;
    return {
      state: area.state,
      district: area.district,
      areaLevel: level,
      item: "Reference grocery basket",
      itemCode: null,
      median: values("median"),
      min: values("min"),
      max: values("max"),
      coverage,
      complete: present.length === components.length,
    };
  }).filter((row) => row.complete);
}

function selectedCustomPremiseRows() {
  if (!customBasket.length || !premiseObservations.length) return [];
  const candidates = premiseObservations.filter((row) =>
    (customStateFilter.value === "all" || row.state === customStateFilter.value)
    && (customDistrictFilter.value === "all" || row.district === customDistrictFilter.value)
  );
  const grouped = new Map();
  candidates.forEach((row) => {
    const area = grouped.get(row.premiseCode) || { premiseCode: row.premiseCode, state: row.state, district: row.district, components: new Map() };
    const itemRows = area.components.get(String(row.itemCode)) || [];
    itemRows.push(row);
    area.components.set(String(row.itemCode), itemRows);
    grouped.set(row.premiseCode, area);
  });
  return [...grouped.values()].map((area) => {
    const windowedRows = latestWindowRows([...area.components.values()].flat());
    const rowsByItem = new Map();
    windowedRows.forEach((row) => {
      const rows = rowsByItem.get(String(row.itemCode)) || [];
      rows.push(row);
      rowsByItem.set(String(row.itemCode), rows);
    });
    const components = customBasket.map((item) => rowsByItem.get(String(item.itemCode)) || []);
    if (components.some((rows) => !rows.length)) return null;
    const median = roundCurrency(components.reduce((sum, rows, index) => sum + roundCurrency(medianOf(rows.map((row) => row.median))) * customBasket[index].quantity, 0));
    const premise = premiseLookup.find((row) => String(row.premise_code) === String(area.premiseCode));
    return { ...area, premise: premise?.premise || `Premise ${area.premiseCode}`, median };
  }).filter(Boolean).sort((a, b) => a.median - b.median);
}

function latestComparableRows(rows) {
  if (!rows.length) return [];
  const latestDate = rows.reduce((latest, row) => row.metricDate > latest ? row.metricDate : latest, "");
  return rows.filter((row) => row.metricDate === latestDate);
}

function renderMetrics(rows) {
  const basketMode = viewFilter.value !== "item";
  const customMode = viewFilter.value === "custom";
  const median = basketMode
    ? roundCurrency(medianOf(rows.map((row) => row.median)))
    : rows.reduce((sum, row) => sum + row.median, 0) / rows.length;
  const min = basketMode ? Math.min(...rows.map((row) => row.median)) : Math.min(...rows.map((row) => row.min));
  const max = basketMode ? Math.max(...rows.map((row) => row.median)) : Math.max(...rows.map((row) => row.max));
  document.querySelector("#median-label").textContent = basketMode ? (customMode ? "Custom basket cost" : "Your 10-item basket costs") : "Median item price";
  document.querySelector("#min-label").textContent = basketMode ? "Cheapest complete basket" : "Lowest observed item";
  document.querySelector("#max-label").textContent = basketMode ? "Most expensive complete basket" : "Highest observed item";
  document.querySelector("#median-value").textContent = money(median);
  document.querySelector("#min-value").textContent = money(min);
  document.querySelector("#max-value").textContent = money(max);
  const areaNames = new Set(rows.map((row) => districtFilter.value === "all" ? row.state : row.district));
  document.querySelector("#areas-value").textContent = areaNames.size;
  document.querySelector("#areas-caption").textContent = `${districtFilter.value === "all" ? "Complete states" : "Complete districts"} compared`;
  document.querySelector("#median-caption").textContent = rows.length === 1 ? (districtFilter.value === "all" ? rows[0].state : rows[0].district) : "Across selected areas";
  document.querySelector("#current-view-label").textContent = document.querySelector("#period-filter").value === "monthly"
    ? (monthlyFallback ? "Latest complete month · fallback" : "Monthly basket prices")
    : "Latest 7-day basket prices";
  document.querySelector("#current-date-range").textContent = metricWindowLabel();
  document.querySelector("#method-copy").textContent = `Based on complete observations from ${metricWindowLabel()}. Prices are median observed prices, not guaranteed store prices. Missing items are never treated as zero.`;
  const areaField = districtFilter.value === "all" ? "state" : "district";
  document.querySelector("#min-caption").textContent = rows.find((row) => (basketMode ? row.median : row.min) === min)?.[areaField] || "Selected area";
  document.querySelector("#max-caption").textContent = rows.find((row) => (basketMode ? row.median : row.max) === max)?.[areaField] || "Selected area";
}

function renderStateBasketChart(rows) {
  const panel = document.querySelector("#state-basket-chart-panel");
  const chart = document.querySelector("#state-basket-chart");
  if (!panel || !chart) return;
  const visible = viewFilter.value !== "item" && districtFilter.value === "all" ? rows : [];
  panel.hidden = !visible.length;
  if (!visible.length) {
    chart.innerHTML = "";
    return;
  }
  const sorted = [...visible].sort((a, b) => b.median - a.median || a.state.localeCompare(b.state));
  const max = Math.max(...sorted.map((row) => row.median));
  chart.innerHTML = sorted.map((row) => `
    <div class="bar-row"><span class="bar-label">${row.state}</span><div class="bar-track"><i style="width:${(row.median / max) * 100}%"></i></div><strong>${money(row.median)}</strong></div>`).join("");
}

function basketTrendRows(period) {
  const source = period === "monthly" ? monthlyHistory : datasets.daily;
  const areaRows = source.filter((row) => row.areaLevel === "state");
  const periods = [...new Set(areaRows.map((row) => row.metricDate))].sort();
  return periods.map((metricDate) => {
    const periodRows = areaRows.filter((row) => row.metricDate === metricDate);
    const baskets = [...new Set(periodRows.map((row) => row.state))].map((state) => {
      const stateRows = periodRows.filter((row) => row.state === state);
      const components = basketComponents.map((component) => {
        const matches = stateRows.filter((row) => component.itemCodes.includes(row.itemCode));
        return matches.length ? medianOf(matches.map((row) => row.median)) : null;
      });
      return components.every((value) => value !== null)
        ? components.reduce((sum, value) => sum + value, 0)
        : null;
    }).filter((value) => value !== null);
    return baskets.length ? { metricDate, median: medianOf(baskets), areas: baskets.length } : null;
  }).filter(Boolean);
}

function renderBasketTrendChart() {
  const panel = document.querySelector("#basket-trend-panel");
  const chart = document.querySelector("#basket-trend-chart");
  const period = document.querySelector("#period-filter")?.value || "daily";
  if (!panel || !chart) return;
  panel.hidden = period !== "monthly";
  if (period !== "monthly") return;
  const rows = basketTrendRows(period);
  const title = document.querySelector("#basket-trend-title");
  const badge = document.querySelector("#basket-trend-badge");
  const subtitle = document.querySelector("#basket-trend-subtitle");
  if (period === "monthly") {
    title.textContent = "Reference basket cost by month";
    badge.textContent = `RM · Monthly · Recent ${MONTHLY_HISTORY_MONTHS} months`;
    subtitle.textContent = "Median complete basket across states for each month. Only areas with every reference-basket component are included.";
  }
  if (!rows.length) {
    chart.innerHTML = '<p class="chart-empty">No complete basket trend is available for this period yet.</p>';
    return;
  }
  const max = Math.max(...rows.map((row) => row.median));
  chart.innerHTML = rows.map((row) => `<div class="basket-trend-column" title="${row.areas} complete areas"><strong>${money(row.median)}</strong><i style="height:${Math.max((row.median / max) * 100, 8)}%"></i><small>${period === "monthly" ? row.metricDate.slice(0, 7) : row.metricDate.slice(5)}</small></div>`).join("");
}

function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function medianRow(rows) {
  return ["median", "min", "max"].reduce((result, field) => ({ ...result, [field]: roundCurrency(medianOf(rows.map((row) => row[field]))) }), {});
}

function resolveBasketComponents(items) {
  return basketRules.map((rule) => ({
    ...rule,
    itemCodes: items
      .filter((item) => item.item_category === rule.category && item.unit.trim().toLowerCase() === rule.unit.toLowerCase() && rule.name(item.item.toUpperCase()))
      .map((item) => item.item_code),
  }));
}

function renderTable(rows) {
  const areaLabel = districtFilter.value === "all" ? "state" : "district";
  const basketMode = viewFilter.value !== "item";
  if (basketMode) {
    const overallMedian = medianOf(rows.map((row) => row.median));
    const grouped = rows.map((row) => ({
      name: areaLabel === "district" ? row.district : row.state,
      median: row.median,
      difference: row.median - overallMedian,
    })).sort((a, b) => a.name.localeCompare(b.name));
    document.querySelector("#table-title").textContent = areaLabel === "state" ? "Basket cost by state" : "Basket cost by district";
    document.querySelector("#area-column").textContent = areaLabel === "state" ? "State" : "District";
    document.querySelector("#median-column").textContent = "Basket cost";
    document.querySelector("#lowest-column").textContent = "Vs. overall median";
    document.querySelector("#highest-column").textContent = "Items";
    document.querySelector("#range-column").textContent = "Window";
    const componentCount = viewFilter.value === "custom" ? customBasket.length : basketComponents.length;
    table.innerHTML = grouped.map((row) => `
      <tr>
        <th scope="row">${row.name}</th>
        <td>${money(row.median)}</td>
        <td>${row.difference === 0 ? "—" : `${row.difference > 0 ? "+" : "−"}${money(Math.abs(row.difference))}`}</td>
        <td>${componentCount}/${componentCount}</td>
        <td>${metricWindowLabel()}</td>
      </tr>`).join("");
    return;
  }
  const grouped = [...rows.reduce((groups, row) => {
    const key = areaLabel === "district" ? row.district : row.state;
    const group = groups.get(key) || { name: key, medians: [], min: Infinity, max: -Infinity };
    group.medians.push(row.median);
    group.min = Math.min(group.min, row.min);
    group.max = Math.max(group.max, row.max);
    groups.set(key, group);
    return groups;
  }, new Map()).values()].map((group) => {
    const values = [...group.medians].sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    return { ...group, median };
  }).sort((a, b) => a.name.localeCompare(b.name));
  document.querySelector("#table-title").textContent = areaLabel === "state" ? "Prices by state" : "Prices by district";
  document.querySelector("#area-column").textContent = areaLabel === "state" ? "State" : "District";
  document.querySelector("#median-column").textContent = "Median";
  document.querySelector("#lowest-column").textContent = "Lowest";
  document.querySelector("#highest-column").textContent = "Highest";
  document.querySelector("#range-column").textContent = "Range";
  table.innerHTML = grouped.map((row) => `
    <tr>
      <th scope="row">${row.name}</th>
      <td>${money(row.median)}</td>
      <td>${money(row.min)}</td>
      <td>${money(row.max)}</td>
      <td><span class="range-bar"><i style="width:${Math.min((row.max - row.min) * 11, 100)}%"></i></span>${money(row.max - row.min)}</td>
    </tr>`).join("");
}

function renderChart() {
  if (!document.querySelector("#trend-chart")) return;
  const max = Math.max(...trend);
  const min = Math.min(...trend);
  document.querySelector("#trend-chart").innerHTML = trend.map((value, index) => `
    <div class="bar-column"><span class="bar-value">${money(value)}</span><div class="bar" style="height:${30 + ((value - min) / (max - min || 1)) * 58}%"><span></span></div><small>${20 + index} Aug</small></div>`).join("");
}

function render() {
  const rows = selectedRows();
  if (dataStatus === "loading") {
    table.innerHTML = '<tr><td colspan="5">Waiting for live data…</td></tr>';
    ["#median-value", "#min-value", "#max-value", "#areas-value"].forEach((selector) => {
      const target = document.querySelector(selector);
      target.innerHTML = '<span class="metric-loading" role="img" aria-label="Loading metric"></span>';
    });
    document.querySelectorAll(".metric-card").forEach((card) => card.setAttribute("aria-busy", "true"));
    document.querySelector(".signal-number").textContent = "—";
    return;
  }
  document.querySelectorAll(".metric-card").forEach((card) => card.removeAttribute("aria-busy"));
  if (!rows.length) {
    const unavailable = dataStatus === "error";
    const monthlyView = document.querySelector("#period-filter").value === "monthly";
    table.innerHTML = `<tr><td colspan="5">No rows match the current filters.</td></tr>`;
    const basketMode = viewFilter.value !== "item";
    document.querySelector("#median-label").textContent = basketMode ? (viewFilter.value === "custom" ? "Custom basket cost" : "Your 10-item basket costs") : "Median item price";
    document.querySelector("#min-label").textContent = basketMode ? "Cheapest complete basket" : "Lowest observed item";
    document.querySelector("#max-label").textContent = basketMode ? "Most expensive complete basket" : "Highest observed item";
    document.querySelector("#median-value").textContent = "—";
    document.querySelector("#min-value").textContent = "—";
    document.querySelector("#max-value").textContent = "—";
    document.querySelector("#areas-value").textContent = "0";
    document.querySelector(".signal-number").textContent = "—";
    document.querySelector(".insight-panel h2").textContent = unavailable ? "Live data unavailable" : basketMode ? "No complete basket yet" : "No matching observations";
    document.querySelector(".signal-copy").textContent = unavailable
      ? "Live data could not be loaded. Use Retry above when the service is available."
      : basketMode
      ? "The source has daily observations, but no selected area has every item in this basket across the latest seven-day window. Try Monthly view or adjust the filters."
      : "There are no observations for the selected item and area. Try another filter or period.";
    document.querySelector("#table-title").textContent = unavailable ? "Live data unavailable" : basketMode ? "Basket availability" : "No matching observations";
    table.innerHTML = `<tr><td colspan="5">${unavailable ? "Live data is temporarily unavailable. No values are shown until it loads successfully." : dataStatus === "empty" ? "Live data is connected, but no matching observations are available for this period." : basketMode ? "Daily data is available, but no area has a complete reference basket in the latest seven-day window." : "No rows match the current filters."}</td></tr>`;
    if (monthlyView && !unavailable) {
      document.querySelector("#current-view-label").textContent = monthlyFallback ? "Latest complete month · fallback" : "No complete monthly basket available";
      document.querySelector("#current-date-range").textContent = metricWindowLabel("monthly");
    }
    renderStateBasketChart([]);
    renderBasketTrendChart();
    return;
  }
  renderMetrics(rows);
  renderStateBasketChart(rows);
  renderBasketTrendChart();
  renderTable(rows);
  const basketMode = viewFilter.value !== "item";
  const low = basketMode ? Math.min(...rows.map((row) => row.median)) : Math.min(...rows.map((row) => row.min));
  const high = basketMode ? Math.max(...rows.map((row) => row.median)) : Math.max(...rows.map((row) => row.max));
  document.querySelector(".signal-number").textContent = money(high - low);
  document.querySelector(".insight-panel h2").textContent = basketMode ? "Basket price spread" : "Item price spread";
  document.querySelector(".signal-copy").textContent = basketMode
    ? "Difference between the cheapest and most expensive complete baskets in the current selection."
    : "Difference between the lowest and highest observed prices in the current selection.";
}

function renderReferenceBasket() {
  document.querySelector("#reference-basket-list").innerHTML = basketRules.map((rule) => `<span class="custom-basket-chip">${rule.label}<small>${rule.unit}</small></span>`).join("");
}

function renderCustomResults(rows) {
  const target = document.querySelector("#custom-results");
  target.hidden = false;
  const grid = target.querySelector(".custom-metric-grid");
  if (!rows.length) {
    const missing = missingCustomItems();
    grid.innerHTML = missing.length
      ? `<p class="custom-basket-copy"><strong>Unavailable items in this area:</strong> ${missing.map((item) => `${item.item} (${item.unit})`).join(", ")}. Comparisons require every selected item.</p>`
      : '<p class="custom-basket-copy">No complete baskets match the current filters. Comparisons require every selected item at the same premise.</p>';
    target.querySelector("#custom-result-table").innerHTML = "";
    return;
  }
  const costs = rows.map((row) => row.median);
  const median = medianOf(costs);
  const cheapest = rows.reduce((a, b) => (a.median < b.median ? a : b));
  const expensive = rows.reduce((a, b) => (a.median > b.median ? a : b));
  grid.innerHTML = [
    ["Median basket cost", median, "Across complete areas"],
    ["Cheapest basket", cheapest.median, cheapest.district || cheapest.state],
    ["Most expensive basket", expensive.median, expensive.district || expensive.state],
    ["Basket spread", expensive.median - cheapest.median, "Cheapest to most expensive"],
  ].map(([label, value, caption]) => `<article class="metric-card"><span class="metric-label">${label}</span><strong>${money(value)}</strong><span class="metric-caption">${caption}</span></article>`).join("");
  target.querySelector("#custom-result-table").innerHTML = rows.map((row) => `<tr><th>${row.premise}</th><td>${row.district || row.state}</td><td>${money(row.median)}</td></tr>`).join("");
}

populateFilters();
renderChart();
renderReferenceBasket();
render();
stateFilter.addEventListener("change", () => { populateFilters(); render(); });
districtFilter.addEventListener("change", render);
itemFilter.addEventListener("change", () => { populateFilters(); render(); });
document.querySelector("#period-filter").addEventListener("change", (event) => {
  const requestedPeriod = event.target.value;
  const actualPeriod = requestedPeriod === "daily" && !datasets.daily.length ? "monthly" : requestedPeriod;
  event.target.value = actualPeriod;
  observations = supabaseLoaded ? (datasets[actualPeriod] || []) : [...demoObservations];
  replaceOptions(customCategory, availableCustomItems().map((item) => item.item_category));
  populateCustomItemOptions();
  document.querySelector(".hero-note strong").textContent = actualPeriod === "monthly" ? "Monthly item prices" : "Latest available prices";
  document.querySelector(".trend-badge").textContent = actualPeriod === "monthly" ? "Historical month" : "Latest 7 days";
  populateFilters();
  render();
});
viewFilter.addEventListener("change", () => {
  const basketMode = viewFilter.value !== "item";
  itemFilter.disabled = basketMode;
  customBasketPanel.hidden = viewFilter.value !== "custom";
  populateFilters();
  render();
});
customCategory.addEventListener("change", populateCustomItemOptions);
customItemSearch.addEventListener("input", populateCustomItemOptions);
document.querySelector("#add-basket-item").addEventListener("click", () => {
  const item = availableItems.find((entry) => String(entry.item_code) === customItem.value);
  const quantity = Number(customQuantity.value);
  if (!item || !Number.isFinite(quantity) || quantity <= 0) return;
  const existing = customBasket.find((entry) => entry.itemCode === item.item_code);
  if (existing) existing.quantity += quantity;
  else customBasket.push({ itemCode: item.item_code, item: item.item, unit: item.unit, quantity });
  renderCustomBuilder();
  render();
});
document.querySelector("#generate-custom-basket").addEventListener("click", async () => {
  if (!customBasket.length) {
    renderCustomResults([]);
    return;
  }
  if (supabaseLoaded && !premiseDataLoaded) {
    renderCustomResults([]);
    document.querySelector("#custom-results .custom-basket-copy").textContent = "Loading the selected items across available premises…";
    await loadPremiseData(customBasket.map((item) => item.itemCode));
    populateCustomLocationFilters();
  }
  viewFilter.value = "custom";
  renderCustomResults(selectedCustomPremiseRows());
});
customStateFilter.addEventListener("change", () => { populateCustomLocationFilters(); renderCustomResults(selectedCustomPremiseRows()); });
customDistrictFilter.addEventListener("change", () => renderCustomResults(selectedCustomPremiseRows()));
document.querySelector("#reset-filters").addEventListener("click", () => {
  stateFilter.value = "all";
  districtFilter.value = "all";
  itemFilter.value = "all";
  viewFilter.value = "basket";
  customStateFilter.value = "all";
  customDistrictFilter.value = "all";
  itemFilter.disabled = true;
  customBasket = [];
  customBasketPanel.hidden = true;
  document.querySelector("#custom-results").hidden = true;
  renderCustomBuilder();
  const periodFilter = document.querySelector("#period-filter");
  const actualPeriod = datasets.daily.length ? "daily" : datasets.monthly.length ? "monthly" : "daily";
  periodFilter.value = actualPeriod;
  observations = supabaseLoaded ? (datasets[actualPeriod] || []) : [...demoObservations];
  replaceOptions(customCategory, availableCustomItems().map((item) => item.item_category));
  populateCustomItemOptions();
  populateCustomLocationFilters();
  document.querySelector(".hero-note strong").textContent = actualPeriod === "monthly" ? "Monthly item prices" : "Latest available prices";
  document.querySelector(".trend-badge").textContent = actualPeriod === "monthly" ? "Historical month" : "Latest 7 days";
  render();
});
document.querySelector("#download-button").addEventListener("click", () => {
  window.alert("Download will be connected to the filtered Supabase view next.");
});

document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", async () => {
    document.querySelectorAll(".nav-button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    document.querySelectorAll("#dashboard-view, #ai-view, #custom-view, #about-view").forEach((view) => { view.hidden = view.id !== button.dataset.view; });
    if (button.dataset.view === "dashboard-view") {
      viewFilter.value = "basket";
      customBasketPanel.hidden = true;
      render();
    } else if (button.dataset.view === "custom-view") {
      viewFilter.value = "custom";
      customBasketPanel.hidden = false;
    } else if (button.dataset.view === "ai-view") {
      if (loadPromise) await loadPromise;
      await loadAiInsight();
      renderInsightMap();
      if (supabaseLoaded && !premiseDataLoaded) {
        await loadPremiseData(basketComponents.flatMap((component) => component.itemCodes));
        renderStatePremiseAnalysis(document.querySelector(".map-state.selected")?.dataset.state || "");
      }
    }
  });
});

const themeToggle = document.querySelector("#theme-toggle");
const themeLabel = document.querySelector("#theme-label");
let theme = localStorage.getItem("pricelens-theme") || "system";
function applyTheme() {
  document.documentElement.dataset.theme = theme;
  themeLabel.textContent = theme[0].toUpperCase() + theme.slice(1);
  themeToggle.setAttribute("aria-label", `Switch theme (currently ${theme} mode)`);
}
themeToggle.addEventListener("click", () => {
  theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  localStorage.setItem("pricelens-theme", theme);
  applyTheme();
});
applyTheme();

async function supabaseGet(path) {
  const controller = activeLoadController || new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(`${config.url}/rest/v1/${path}`, {
    headers: { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}` },
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Live data request timed out after 15 seconds.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`Supabase request failed (${response.status})`);
  return response.json();
}

async function supabaseGetAll(path, pageSize = 1000) {
  const rows = [];
  let offset = 0;
  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const page = await supabaseGet(`${path}${separator}limit=${pageSize}&offset=${offset}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
    offset += pageSize;
  }
}

function toRows(rows, itemNames) {
  return rows.map((row) => ({
    metricDate: row.metric_date || row.metric_month || "",
    state: row.state,
    district: row.district || "",
    areaLevel: row.area_level,
    item: itemNames.get(String(row.item_code)) || `Item ${row.item_code}`,
    itemCode: row.item_code,
    median: Number(row.median_price),
    min: Number(row.min_price),
    max: Number(row.max_price),
  }));
}

async function loadAiInsight() {
  if (aiLoadPromise) return aiLoadPromise;
  if (!supabaseLoaded || !datasets.daily.length) {
    aiInsightStatus = "not available";
    document.querySelector("#ai-insight-copy").textContent = "AI insight requires live structured data first.";
    document.querySelector("#ai-general-copy").textContent = "AI insight requires live structured data first.";
    document.querySelector("#ai-general-meta").textContent = "Live metrics are not available yet.";
    return;
  }
  document.querySelector("#ai-insight-copy").textContent = "Loading the latest stored insight…";
  document.querySelector("#ai-general-copy").textContent = "Loading the latest stored insight…";
  document.querySelector("#ai-general-meta").textContent = "AI insights load separately from the main dashboard data.";
  aiLoadPromise = (async () => {
    try {
      const insights = await supabaseGet("ai_insights?select=generated_text,provider,insight_date,analytical_payload&insight_type=eq.daily_summary&order=insight_date.desc&limit=1");
      const latestInsight = insights[0];
      const payload = latestInsight?.analytical_payload || {};
      const currentReference = structuredReferenceBasketValue(datasets.daily);
      const storedReference = Number(payload.reference_basket?.basket_median_reference);
      const matchesCurrentData = Boolean(
        latestInsight
        && dailyDateForPremise
        && payload.latest_metric_date === dailyDateForPremise
        && currentReference !== null
        && Number.isFinite(storedReference)
        && Math.abs(currentReference - storedReference) < 0.005
      );
      aiInsightStatus = matchesCurrentData ? "stored and current" : latestInsight ? "withheld as stale" : "not available";
      aiInsightBundle = matchesCurrentData ? payload : { general: "", states: {} };
      const generalInsight = matchesCurrentData
        ? aiInsightBundle.general || latestInsight.generated_text || "No generated insight is available yet."
        : "The stored explanation is not shown because it does not match the current metric window. Structured metrics remain available.";
      document.querySelector("#ai-insight-copy").textContent = generalInsight;
      document.querySelector("#ai-general-copy").textContent = generalInsight;
      renderAiGeneralFacts();
      document.querySelector("#ai-general-meta").textContent = latestInsight
        ? `Stored ${latestInsight.insight_date} · ${latestInsight.provider || "rule-based"} explanation · ${aiInsightStatus} · metric date ${payload.latest_metric_date || "unknown"}`
        : "No stored insight is available. Structured metrics remain available without AI.";
    } catch (error) {
      console.warn("AI insight is not available; structured metrics remain available.", error);
      aiInsightStatus = "unavailable";
      aiInsightBundle = { general: "", states: {} };
      document.querySelector("#ai-insight-copy").textContent = "AI insight is unavailable; structured metrics remain available.";
      document.querySelector("#ai-general-copy").textContent = "AI insight is unavailable; structured metrics remain available.";
      document.querySelector("#ai-general-meta").textContent = "AI is unavailable; this page uses structured metrics only.";
      renderAiGeneralFacts();
    }
  })().finally(() => { aiLoadPromise = null; });
  return aiLoadPromise;
}

async function loadSupabaseData() {
  const banner = document.querySelector("#data-status-message");
  if (!config.url || !config.anonKey || config.anonKey.startsWith("sb_secret_")) {
    observations = [...demoObservations];
    dataStatus = "preview";
    setDataStatus("preview", "Live data is not configured — showing preview data only.");
    render();
    return;
  }
  const items = await supabaseGet("item_lookup?select=item_code,item,unit,item_group,item_category&order=item.asc&limit=1000");
  availableItems = items;
  replaceOptions(customCategory, items.map((item) => item.item_category));
  populateCustomItemOptions();
  const itemNames = new Map(items.map((row) => [String(row.item_code), row.item]));
  basketComponents = resolveBasketComponents(items);
  const latestDaily = await supabaseGet("daily_item_area_summary?select=metric_date&area_level=eq.state&order=metric_date.desc&limit=1");
  const latestMonthly = await supabaseGet("monthly_item_area_summary?select=metric_month&area_level=eq.state&order=metric_month.desc&limit=1");
  const dailyDate = latestDaily[0]?.metric_date;
  const monthlyDate = latestMonthly[0]?.metric_month;
  document.querySelector(".hero-note > span:last-child").textContent = formatMetricDate(dailyDate);
  const dailyStart = dailyDate ? new Date(`${dailyDate}T00:00:00Z`) : null;
  if (dailyStart) dailyStart.setUTCDate(dailyStart.getUTCDate() - (DAILY_WINDOW_DAYS - 1));
  const dailyStartDate = dailyStart ? dailyStart.toISOString().slice(0, 10) : "";
  dailyDateForPremise = dailyDate || "";
  dailyStartDateForPremise = dailyStartDate;
  const dailyDates = dailyDate ? Array.from({ length: DAILY_WINDOW_DAYS }, (_, index) => {
    const value = new Date(`${dailyDate}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() - index);
    return value.toISOString().slice(0, 10);
  }).sort() : [];
  const dailyPages = await Promise.all(dailyDates.map((metricDate) =>
    supabaseGetAll(`daily_item_area_summary?select=metric_date,area_level,state,district,item_code,min_price,median_price,max_price&area_level=eq.state&metric_date=eq.${metricDate}&order=state.asc,item_code.asc`)
  ));
  const daily = dailyPages.flat();
  try {
    canonicalDailyBasketRows = dailyDate
      ? await supabaseGetAll(`daily_basket_summary?select=metric_date,state,basket_median,cross_state_reference,reference_basket_items_observed,reference_basket_items_total,reference_basket_days_observed&metric_date=eq.${dailyDate}&order=state.asc`)
      : [];
  } catch (error) {
    console.warn("Canonical basket summary is unavailable; using detailed summaries.", error);
    canonicalDailyBasketRows = [];
  }
  const dailyDistricts = dailyDate ? await supabaseGetAll(`daily_item_area_summary?select=metric_date,area_level,state,district,item_code,min_price,median_price,max_price&area_level=eq.district&metric_date=eq.${dailyDate}&order=state.asc,district.asc,item_code.asc`) : [];
  const monthlyLatest = monthlyDate ? await supabaseGetAll(`monthly_item_area_summary?select=metric_month,area_level,state,district,item_code,min_price,median_price,max_price&metric_month=eq.${monthlyDate}&order=state.asc,item_code.asc`) : [];
  const monthlyHistoryStart = monthlyDate ? new Date(`${monthlyDate}T00:00:00Z`) : null;
  const monthlyDates = monthlyHistoryStart ? Array.from({ length: MONTHLY_HISTORY_MONTHS }, (_, index) => {
    const value = new Date(monthlyHistoryStart);
    value.setUTCMonth(value.getUTCMonth() - index);
    return value.toISOString().slice(0, 10);
  }).sort() : [];
  const monthlyHistoryPages = await Promise.all(monthlyDates.map((metricMonth) =>
    supabaseGetAll(`monthly_item_area_summary?select=metric_month,area_level,state,district,item_code,min_price,median_price,max_price&area_level=eq.state&metric_month=eq.${metricMonth}&order=state.asc,item_code.asc`)
  ));
  const monthlyHistoryRows = monthlyHistoryPages.flat();
  const latestMonthlyRows = toRows(monthlyLatest, itemNames);
  const historyMonthlyRows = toRows(monthlyHistoryRows, itemNames);
  const completeLatestMonth = monthlyCompleteStateRows(latestMonthlyRows);
  const fallbackMonth = [...new Set(historyMonthlyRows.map((row) => row.metricDate))]
    .sort()
    .reverse()
    .find((metricDate) => monthlyCompleteStateRows(historyMonthlyRows.filter((row) => row.metricDate === metricDate)).length);
  monthlyFallback = Boolean(monthlyDate && !completeLatestMonth.length && fallbackMonth && fallbackMonth !== monthlyDate);
  monthlyDisplayDate = monthlyFallback ? fallbackMonth : monthlyDate || "";
  const monthly = monthlyFallback
    ? historyMonthlyRows.filter((row) => row.metricDate === monthlyDisplayDate)
    : latestMonthlyRows;
  if (!daily.length && !monthly.length) {
    setDataStatus("empty", `Live data is connected, but no observations are available yet.${lastSuccessfulCopy()}`);
    observations = [];
    render();
    return;
  }
  datasets.daily = toRows([...daily, ...dailyDistricts], itemNames);
  datasets.monthly = monthly;
  monthlyHistory = historyMonthlyRows;
  supabaseLoaded = true;
  dataStatus = "success";
  lastSuccessfulDate = dailyDate || monthlyDate || "";
  if (lastSuccessfulDate) localStorage.setItem("pricelens-last-successful-date", lastSuccessfulDate);
  const periodFilter = document.querySelector("#period-filter");
  if (periodFilter.value === "daily" && !datasets.daily.length) periodFilter.value = "monthly";
  observations = datasets[periodFilter.value];
  replaceOptions(customCategory, availableCustomItems().map((item) => item.item_category));
  populateCustomItemOptions();
  populateCustomLocationFilters();
  document.querySelector(".hero-note strong").textContent = periodFilter.value === "monthly" ? "Monthly item prices" : "Latest available prices";
  document.querySelector(".trend-badge").textContent = periodFilter.value === "monthly" ? "Historical month" : "Latest 7 days";
  districts = {};
  dailyDistricts.forEach((row) => {
    if (row.district) districts[row.state] = [...new Set([...(districts[row.state] || []), row.district])];
  });
  [...datasets.daily, ...datasets.monthly].forEach((row) => {
    if (row.district) districts[row.state] = [...new Set([...(districts[row.state] || []), row.district])];
  });
  populateFilters();
  render();
  renderAiGeneralFacts();
  renderAboutQuality();
  renderInsightMap();
  setDataStatus("success", `Connected to live data · latest daily window through ${dailyDate || "pending"} · ${monthlyDisplayDate ? `monthly ${monthlyDisplayDate}${monthlyFallback ? " · latest complete month fallback" : ""}` : "monthly summary pending"}`);
}

async function loadPremiseData(itemCodes) {
  if (premiseDataLoading || !dailyDateForPremise) return;
  premiseDataLoading = true;
  try {
    premiseLookup = await supabaseGetAll("premise_lookup?select=premise_code,premise,state,district&order=premise_code.asc");
    const codes = [...new Set(itemCodes.map((code) => Number(code)).filter(Number.isInteger))];
    const codeFilter = codes.length ? `&item_code=in.(${codes.join(",")})` : "";
    const premiseDaily = await supabaseGetAll(`daily_item_premise_summary?select=metric_date,premise_code,item_code,min_price,median_price,max_price&metric_date=gte.${dailyStartDateForPremise}&metric_date=lte.${dailyDateForPremise}${codeFilter}&order=metric_date.asc,premise_code.asc,item_code.asc`);
    premiseObservations = premiseDaily.map((row) => {
      const premise = premiseLookup.find((entry) => String(entry.premise_code) === String(row.premise_code));
      return {
        metricDate: row.metric_date,
        premiseCode: row.premise_code,
        itemCode: row.item_code,
        state: premise?.state || "",
        district: premise?.district || "",
        premise: premise?.premise || "",
        median: Number(row.median_price),
        min: Number(row.min_price),
        max: Number(row.max_price),
      };
    });
    premiseDataLoaded = true;
    renderAiGeneralFacts();
    renderAboutQuality();
  } catch (error) {
    console.warn("Premise comparison could not be loaded.", error);
  } finally {
    premiseDataLoading = false;
  }
}

function startDataLoad() {
  if (loadPromise) return loadPromise;
  activeLoadController = new AbortController();
  const loadTimeout = window.setTimeout(() => activeLoadController?.abort(), 20000);
  setDataStatus("loading", "Loading live data from Supabase…");
  render();
  loadPromise = loadSupabaseData().catch((error) => {
    console.warn("Live data could not be loaded.", error);
    supabaseLoaded = false;
    observations = [];
    setDataStatus("error", `Live data is temporarily unavailable.${lastSuccessfulCopy()} Please try again later.`, { retry: true });
    render();
  }).finally(() => {
    window.clearTimeout(loadTimeout);
    activeLoadController = null;
    loadPromise = null;
  });
  return loadPromise;
}

document.querySelector("#retry-data").addEventListener("click", () => startDataLoad());
startDataLoad();
