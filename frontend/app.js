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

const stateFilter = document.querySelector("#state-filter");
const districtFilter = document.querySelector("#district-filter");
const itemFilter = document.querySelector("#item-filter");
const table = document.querySelector("#state-table");

function replaceOptions(select, values) {
  const first = select.querySelector("option").cloneNode(true);
  select.replaceChildren(first);
  [...new Set(values)].filter(Boolean).sort().forEach((value) => {
    select.insertAdjacentHTML("beforeend", `<option value="${value}">${value}</option>`);
  });
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
  return observations.filter((row) => {
    const stateMatches = stateFilter.value === "all" || row.state === stateFilter.value;
    const itemMatches = itemFilter.value === "all" || row.item === itemFilter.value;
    const districtMatches = districtFilter.value === "all" || (districts[row.state] || []).includes(districtFilter.value);
    const levelMatches = !row.areaLevel || row.areaLevel === (districtFilter.value === "all" ? "state" : "district");
    return stateMatches && itemMatches && districtMatches && levelMatches;
  });
}

function renderMetrics(rows) {
  const median = rows.reduce((sum, row) => sum + row.median, 0) / rows.length;
  const min = Math.min(...rows.map((row) => row.min));
  const max = Math.max(...rows.map((row) => row.max));
  document.querySelector("#median-value").textContent = money(median);
  document.querySelector("#min-value").textContent = money(min);
  document.querySelector("#max-value").textContent = money(max);
  const areaNames = new Set(rows.map((row) => districtFilter.value === "all" ? row.state : row.district));
  document.querySelector("#areas-value").textContent = areaNames.size;
  document.querySelector("#median-caption").textContent = rows.length === 1 ? rows[0].state : "Across selected areas";
  document.querySelector("#min-caption").textContent = rows.find((row) => row.min === min)?.state || "Selected area";
  document.querySelector("#max-caption").textContent = rows.find((row) => row.max === max)?.state || "Selected area";
}

function renderTable(rows) {
  const areaLabel = districtFilter.value === "all" ? "state" : "district";
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
  const max = Math.max(...trend);
  const min = Math.min(...trend);
  document.querySelector("#trend-chart").innerHTML = trend.map((value, index) => `
    <div class="bar-column"><span class="bar-value">${money(value)}</span><div class="bar" style="height:${30 + ((value - min) / (max - min || 1)) * 58}%"><span></span></div><small>${20 + index} Aug</small></div>`).join("");
}

function render() {
  const rows = selectedRows();
  if (!rows.length) {
    table.innerHTML = `<tr><td colspan="5">No rows match the current filters.</td></tr>`;
    document.querySelector("#median-value").textContent = "—";
    document.querySelector("#min-value").textContent = "—";
    document.querySelector("#max-value").textContent = "—";
    document.querySelector("#areas-value").textContent = "0";
    return;
  }
  renderMetrics(rows);
  renderTable(rows);
}

populateFilters();
renderChart();
render();
stateFilter.addEventListener("change", () => { populateFilters(); render(); });
districtFilter.addEventListener("change", render);
itemFilter.addEventListener("change", () => { populateFilters(); render(); });
document.querySelector("#period-filter").addEventListener("change", (event) => {
  const requestedPeriod = event.target.value;
  const actualPeriod = requestedPeriod === "daily" && !datasets.daily.length ? "monthly" : requestedPeriod;
  event.target.value = actualPeriod;
  observations = supabaseLoaded ? (datasets[actualPeriod] || []) : [...demoObservations];
  document.querySelector(".hero-note strong").textContent = actualPeriod === "monthly" ? "Monthly item prices" : "Daily item prices";
  document.querySelector(".trend-badge").textContent = actualPeriod === "monthly" ? "Historical month" : "Latest day";
  populateFilters();
  render();
});
document.querySelector("#reset-filters").addEventListener("click", () => {
  stateFilter.value = "all";
  districtFilter.value = "all";
  itemFilter.value = "all";
  const periodFilter = document.querySelector("#period-filter");
  const actualPeriod = datasets.daily.length ? "daily" : datasets.monthly.length ? "monthly" : "daily";
  periodFilter.value = actualPeriod;
  observations = supabaseLoaded ? (datasets[actualPeriod] || []) : [...demoObservations];
  document.querySelector(".hero-note strong").textContent = actualPeriod === "monthly" ? "Monthly item prices" : "Daily item prices";
  document.querySelector(".trend-badge").textContent = actualPeriod === "monthly" ? "Historical month" : "Latest day";
  render();
});
document.querySelector("#download-button").addEventListener("click", () => {
  window.alert("Download will be connected to the filtered Supabase view next.");
});

document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    document.querySelectorAll("#dashboard-view, #about-view").forEach((view) => { view.hidden = view.id !== button.dataset.view; });
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
  const items = await supabaseGet("item_lookup?select=item_code,item&order=item.asc&limit=1000");
  const itemNames = new Map(items.map((row) => [String(row.item_code), row.item]));
  const latestDaily = await supabaseGet("daily_item_area_summary?select=metric_date&area_level=eq.state&order=metric_date.desc&limit=1");
  const latestMonthly = await supabaseGet("monthly_item_area_summary?select=metric_month&area_level=eq.state&order=metric_month.desc&limit=1");
  const dailyDate = latestDaily[0]?.metric_date;
  const monthlyDate = latestMonthly[0]?.metric_month;
  const daily = dailyDate ? await supabaseGetAll(`daily_item_area_summary?select=metric_date,area_level,state,district,item_code,min_price,median_price,max_price&metric_date=eq.${dailyDate}&order=state.asc,item_code.asc`) : [];
  const monthly = monthlyDate ? await supabaseGetAll(`monthly_item_area_summary?select=metric_month,area_level,state,district,item_code,min_price,median_price,max_price&metric_month=eq.${monthlyDate}&order=state.asc,item_code.asc`) : [];
  if (!daily.length && !monthly.length) return;
  const districtTable = dailyDate ? "daily_item_area_summary" : "monthly_item_area_summary";
  const districtDateFilter = dailyDate ? `metric_date=eq.${dailyDate}` : `metric_month=eq.${monthlyDate}`;
  const districtLookup = await supabaseGetAll(`${districtTable}?select=state,district&area_level=eq.district&${districtDateFilter}&order=state.asc,district.asc`);
  datasets.daily = toRows(daily, itemNames);
  datasets.monthly = toRows(monthly, itemNames);
  supabaseLoaded = true;
  const periodFilter = document.querySelector("#period-filter");
  if (periodFilter.value === "daily" && !datasets.daily.length) periodFilter.value = "monthly";
  observations = datasets[periodFilter.value];
  document.querySelector(".hero-note strong").textContent = periodFilter.value === "monthly" ? "Monthly item prices" : "Daily item prices";
  document.querySelector(".trend-badge").textContent = periodFilter.value === "monthly" ? "Historical month" : "Latest day";
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
  banner.textContent = `Connected to Supabase · ${dailyDate ? `daily ${dailyDate}` : "daily summary pending"} · ${monthlyDate ? `monthly ${monthlyDate}` : "monthly summary pending"}`;
}

loadSupabaseData().catch((error) => {
  console.warn("Using preview data because Supabase is not configured.", error);
});
