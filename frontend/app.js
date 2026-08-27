const observations = [
  { state: "Selangor", item: "Eggs", median: 12.4, min: 8.9, max: 16.8 },
  { state: "Johor", item: "Eggs", median: 11.8, min: 9.2, max: 15.5 },
  { state: "Pulau Pinang", item: "Eggs", median: 13.2, min: 10.0, max: 17.1 },
  { state: "Kedah", item: "Eggs", median: 10.9, min: 8.8, max: 14.0 },
  { state: "Perak", item: "Eggs", median: 11.5, min: 9.0, max: 15.0 },
  { state: "Sarawak", item: "Eggs", median: 14.1, min: 11.5, max: 18.2 },
  { state: "Sabah", item: "Eggs", median: 14.8, min: 12.0, max: 19.2 },
  { state: "Negeri Sembilan", item: "Eggs", median: 12.1, min: 9.5, max: 15.8 },
];

const districts = {
  Selangor: ["Petaling", "Gombak", "Klang"], Johor: ["Johor Bahru", "Batu Pahat"],
  "Pulau Pinang": ["Timur Laut", "Seberang Perai Tengah"], Kedah: ["Kota Setar", "Sungai Petani"],
  Perak: ["Kinta", "Manjung"], Sarawak: ["Kuching", "Miri"], Sabah: ["Kota Kinabalu", "Sandakan"],
  "Negeri Sembilan": ["Seremban", "Port Dickson"],
};

const trend = [11.7, 12.1, 12.0, 12.6, 12.3, 12.8, 12.4];
const money = (value) => `RM ${value.toFixed(2)}`;

const stateFilter = document.querySelector("#state-filter");
const districtFilter = document.querySelector("#district-filter");
const itemFilter = document.querySelector("#item-filter");
const table = document.querySelector("#state-table");

function populateFilters() {
  [...new Set(observations.map((row) => row.state))].sort().forEach((state) => {
    stateFilter.insertAdjacentHTML("beforeend", `<option value="${state}">${state}</option>`);
  });
  [...new Set(observations.map((row) => row.item))].sort().forEach((item) => {
    itemFilter.insertAdjacentHTML("beforeend", `<option value="${item}">${item}</option>`);
  });
  Object.values(districts).flat().sort().forEach((district) => {
    districtFilter.insertAdjacentHTML("beforeend", `<option value="${district}">${district}</option>`);
  });
}

function selectedRows() {
  return observations.filter((row) => {
    const stateMatches = stateFilter.value === "all" || row.state === stateFilter.value;
    const itemMatches = itemFilter.value === "all" || row.item === itemFilter.value;
    const districtMatches = districtFilter.value === "all" || (districts[row.state] || []).includes(districtFilter.value);
    return stateMatches && itemMatches && districtMatches;
  });
}

function renderMetrics(rows) {
  const median = rows.reduce((sum, row) => sum + row.median, 0) / rows.length;
  const min = Math.min(...rows.map((row) => row.min));
  const max = Math.max(...rows.map((row) => row.max));
  document.querySelector("#median-value").textContent = money(median);
  document.querySelector("#min-value").textContent = money(min);
  document.querySelector("#max-value").textContent = money(max);
  document.querySelector("#areas-value").textContent = rows.length;
  document.querySelector("#median-caption").textContent = rows.length === 1 ? rows[0].state : "Across selected states";
  document.querySelector("#min-caption").textContent = rows.find((row) => row.min === min)?.state || "Selected area";
  document.querySelector("#max-caption").textContent = rows.find((row) => row.max === max)?.state || "Selected area";
}

function renderTable(rows) {
  table.innerHTML = rows.map((row) => `
    <tr>
      <th scope="row">${row.state}</th>
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
  renderMetrics(rows);
  renderTable(rows);
}

populateFilters();
renderChart();
render();
stateFilter.addEventListener("change", render);
districtFilter.addEventListener("change", render);
itemFilter.addEventListener("change", render);
document.querySelector("#period-filter").addEventListener("change", render);
document.querySelector("#reset-filters").addEventListener("click", () => {
  stateFilter.value = "all";
  districtFilter.value = "all";
  itemFilter.value = "all";
  document.querySelector("#period-filter").value = "daily";
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
