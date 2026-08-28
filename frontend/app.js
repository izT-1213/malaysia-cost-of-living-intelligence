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

let observations = [...demoObservations];
const datasets = { daily: [], monthly: [] };
let supabaseLoaded = false;
let districts = {
  Selangor: ["Petaling", "Gombak", "Klang"], Johor: ["Johor Bahru", "Batu Pahat"],
  "Pulau Pinang": ["Timur Laut", "Seberang Perai Tengah"], Kedah: ["Kota Setar", "Sungai Petani"],
  Perak: ["Kinta", "Manjung"], Sarawak: ["Kuching", "Miri"], Sabah: ["Kota Kinabalu", "Sandakan"],
  "Negeri Sembilan": ["Seremban", "Port Dickson"],
};

const trend = [11.7, 12.1, 12.0, 12.6, 12.3, 12.8, 12.4];
const money = (value) => `RM ${value.toFixed(2)}`;
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
const customItem = document.querySelector("#custom-item");
const customQuantity = document.querySelector("#custom-quantity");
const customBasketList = document.querySelector("#custom-basket-list");
const customStateFilter = document.querySelector("#custom-state-filter");
const customDistrictFilter = document.querySelector("#custom-district-filter");
let availableItems = [];
let customBasket = [];
let premiseLookup = [];
let premiseObservations = [];

function replaceOptions(select, values) {
  const first = select.querySelector("option").cloneNode(true);
  select.replaceChildren(first);
  [...new Set(values)].filter(Boolean).sort().forEach((value) => {
    select.insertAdjacentHTML("beforeend", `<option value="${value}">${value}</option>`);
  });
}

function renderCustomBuilder() {
  customBasketList.innerHTML = customBasket.length
    ? customBasket.map((entry, index) => `<span class="custom-basket-chip">${entry.item} × ${entry.quantity} ${entry.unit}<button type="button" data-remove-basket-index="${index}" aria-label="Remove ${entry.item}">×</button></span>`).join("")
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
  const filtered = availableCustomItems().filter((item) => category === "all" || item.item_category === category);
  customItem.replaceChildren(new Option("Choose an item", ""));
  filtered.sort((a, b) => a.item.localeCompare(b.item)).forEach((item) => {
    customItem.add(new Option(`${item.item} · ${item.unit}`, String(item.item_code)));
  });
}

function availableCustomItems() {
  const observedCodes = new Set(observations.map((row) => String(row.itemCode)).filter(Boolean));
  return supabaseLoaded && observedCodes.size
    ? availableItems.filter((item) => observedCodes.has(String(item.item_code)))
    : availableItems;
}

function populateCustomLocationFilters() {
  const observedPremises = new Set(premiseObservations.map((row) => String(row.premiseCode)));
  const locations = premiseLookup.filter((row) => observedPremises.has(String(row.premise_code)));
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
  const candidates = observations.filter((row) => {
    if (row.areaLevel && row.areaLevel !== level) return false;
    if (stateFilter.value !== "all" && row.state !== stateFilter.value) return false;
    if (districtFilter.value !== "all" && row.district !== districtFilter.value) return false;
    return true;
  });
  const grouped = new Map();
  candidates.forEach((row) => {
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
      const recentMatches = latestComparableRows(matches);
      return recentMatches.length ? { ...component, row: medianRow(recentMatches) } : null;
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
    const components = customBasket.map((item) => latestComparableRows(area.components.get(String(item.itemCode)) || []));
    if (components.some((rows) => !rows.length)) return null;
    const median = components.reduce((sum, rows, index) => sum + medianOf(rows.map((row) => row.median)) * customBasket[index].quantity, 0);
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
  const median = basketMode ? medianOf(rows.map((row) => row.median)) : rows.reduce((sum, row) => sum + row.median, 0) / rows.length;
  const min = basketMode ? Math.min(...rows.map((row) => row.median)) : Math.min(...rows.map((row) => row.min));
  const max = basketMode ? Math.max(...rows.map((row) => row.median)) : Math.max(...rows.map((row) => row.max));
  document.querySelector("#median-label").textContent = basketMode ? (customMode ? "Custom basket cost" : "Reference basket cost") : "Median item price";
  document.querySelector("#min-label").textContent = basketMode ? "Cheapest complete basket" : "Lowest observed item";
  document.querySelector("#max-label").textContent = basketMode ? "Most expensive complete basket" : "Highest observed item";
  document.querySelector("#median-value").textContent = money(median);
  document.querySelector("#min-value").textContent = money(min);
  document.querySelector("#max-value").textContent = money(max);
  const areaNames = new Set(rows.map((row) => districtFilter.value === "all" ? row.state : row.district));
  document.querySelector("#areas-value").textContent = areaNames.size;
  document.querySelector("#median-caption").textContent = rows.length === 1 ? (districtFilter.value === "all" ? rows[0].state : rows[0].district) : "Across selected areas";
  const areaField = districtFilter.value === "all" ? "state" : "district";
  document.querySelector("#min-caption").textContent = rows.find((row) => (basketMode ? row.median : row.min) === min)?.[areaField] || "Selected area";
  document.querySelector("#max-caption").textContent = rows.find((row) => (basketMode ? row.median : row.max) === max)?.[areaField] || "Selected area";
}

function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function medianRow(rows) {
  return ["median", "min", "max"].reduce((result, field) => ({ ...result, [field]: medianOf(rows.map((row) => row[field])) }), {});
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
        <td>Latest 7 days</td>
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
  if (!rows.length) {
    table.innerHTML = `<tr><td colspan="5">No rows match the current filters.</td></tr>`;
    const basketMode = viewFilter.value !== "item";
    document.querySelector("#median-label").textContent = basketMode ? (viewFilter.value === "custom" ? "Custom basket cost" : "Reference basket cost") : "Median item price";
    document.querySelector("#min-label").textContent = basketMode ? "Cheapest complete basket" : "Lowest observed item";
    document.querySelector("#max-label").textContent = basketMode ? "Most expensive complete basket" : "Highest observed item";
    document.querySelector("#median-value").textContent = "—";
    document.querySelector("#min-value").textContent = "—";
    document.querySelector("#max-value").textContent = "—";
    document.querySelector("#areas-value").textContent = "0";
    document.querySelector(".signal-number").textContent = "—";
    document.querySelector(".insight-panel h2").textContent = basketMode ? "No complete basket yet" : "No matching observations";
    document.querySelector(".signal-copy").textContent = basketMode
      ? "The source has daily observations, but no selected area has every item in this basket across the latest seven-day window. Try Monthly view or adjust the filters."
      : "There are no observations for the selected item and area. Try another filter or period.";
    document.querySelector("#table-title").textContent = basketMode ? "Basket availability" : "No matching observations";
    table.innerHTML = `<tr><td colspan="5">${basketMode ? "Daily data is available, but no area has a complete reference basket in the latest seven-day window." : "No rows match the current filters."}</td></tr>`;
    return;
  }
  renderMetrics(rows);
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
    grid.innerHTML = '<p class="custom-basket-copy">No complete baskets match the current filters.</p>';
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
document.querySelector("#generate-custom-basket").addEventListener("click", () => {
  if (!customBasket.length) {
    renderCustomResults([]);
    return;
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
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    document.querySelectorAll("#dashboard-view, #custom-view, #about-view").forEach((view) => { view.hidden = view.id !== button.dataset.view; });
    if (button.dataset.view === "dashboard-view") {
      viewFilter.value = "basket";
      customBasketPanel.hidden = true;
      render();
    } else if (button.dataset.view === "custom-view") {
      viewFilter.value = "custom";
      customBasketPanel.hidden = false;
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
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    headers: { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}` },
  });
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

async function loadSupabaseData() {
  if (!config.url || !config.anonKey || config.anonKey.startsWith("sb_secret_")) return;
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
  const dailyStart = dailyDate ? new Date(`${dailyDate}T00:00:00Z`) : null;
  if (dailyStart) dailyStart.setUTCDate(dailyStart.getUTCDate() - 6);
  const dailyStartDate = dailyStart ? dailyStart.toISOString().slice(0, 10) : "";
  const daily = dailyDate ? await supabaseGetAll(`daily_item_area_summary?select=metric_date,area_level,state,district,item_code,min_price,median_price,max_price&metric_date=gte.${dailyStartDate}&metric_date=lte.${dailyDate}&order=metric_date.asc,state.asc,item_code.asc`) : [];
  let premiseDaily = [];
  try {
    premiseLookup = await supabaseGetAll("premise_lookup?select=premise_code,premise,state,district&order=premise_code.asc");
    premiseDaily = dailyDate ? await supabaseGetAll(`daily_item_premise_summary?select=metric_date,premise_code,item_code,min_price,median_price,max_price&metric_date=gte.${dailyStartDate}&metric_date=lte.${dailyDate}&order=metric_date.asc,premise_code.asc,item_code.asc`) : [];
  } catch (error) {
    console.warn("Premise comparison is not available until migration 004 is applied.", error);
  }
  const monthly = monthlyDate ? await supabaseGetAll(`monthly_item_area_summary?select=metric_month,area_level,state,district,item_code,min_price,median_price,max_price&metric_month=eq.${monthlyDate}&order=state.asc,item_code.asc`) : [];
  if (!daily.length && !monthly.length) return;
  const districtTable = dailyDate ? "daily_item_area_summary" : "monthly_item_area_summary";
  const districtDateFilter = dailyDate ? `metric_date=eq.${dailyDate}` : `metric_month=eq.${monthlyDate}`;
  const districtLookup = await supabaseGetAll(`${districtTable}?select=state,district&area_level=eq.district&${districtDateFilter}&order=state.asc,district.asc`);
  datasets.daily = toRows(daily, itemNames);
  datasets.monthly = toRows(monthly, itemNames);
  premiseObservations = premiseDaily.map((row) => ({
    metricDate: row.metric_date,
    premiseCode: row.premise_code,
    itemCode: row.item_code,
    state: premiseLookup.find((premise) => String(premise.premise_code) === String(row.premise_code))?.state || "",
    district: premiseLookup.find((premise) => String(premise.premise_code) === String(row.premise_code))?.district || "",
    median: Number(row.median_price),
    min: Number(row.min_price),
    max: Number(row.max_price),
  }));
  supabaseLoaded = true;
  const periodFilter = document.querySelector("#period-filter");
  if (periodFilter.value === "daily" && !datasets.daily.length) periodFilter.value = "monthly";
  observations = datasets[periodFilter.value];
  replaceOptions(customCategory, availableCustomItems().map((item) => item.item_category));
  populateCustomItemOptions();
  populateCustomLocationFilters();
  document.querySelector(".hero-note strong").textContent = periodFilter.value === "monthly" ? "Monthly item prices" : "Latest available prices";
  document.querySelector(".trend-badge").textContent = periodFilter.value === "monthly" ? "Historical month" : "Latest 7 days";
  districts = {};
  districtLookup.forEach((row) => {
    if (row.district) districts[row.state] = [...new Set([...(districts[row.state] || []), row.district])];
  });
  [...datasets.daily, ...datasets.monthly].forEach((row) => {
    if (row.district) districts[row.state] = [...new Set([...(districts[row.state] || []), row.district])];
  });
  populateFilters();
  render();
  const banner = document.querySelector(".demo-banner span:last-child");
  banner.textContent = `Connected to Supabase · latest daily window through ${dailyDate || "pending"} · ${monthlyDate ? `monthly ${monthlyDate}` : "monthly summary pending"}`;
}

loadSupabaseData().catch((error) => {
  console.warn("Using preview data because Supabase is not configured.", error);
});
