import { api, clearToken, getToken } from "./api.js";

declare const Chart: any;

interface WeekRecord { weekStart: string; units: number }
interface DailyRecord { date: string; reading: number; readingType: "daily_use" | "meter_total"; units: number | null; derived: boolean; needsBaseline?: boolean; invalidDrop?: boolean; previousReadingDate?: string }
interface Dashboard {
  history: WeekRecord[];
  averageWeeklyUnits: number;
  comparison: { current: number; previous: number; change: number; changePercent: number | null } | null;
  alert: { type: string; message: string } | null;
  tips: string[];
  invoiceDay: number;
  alerts?: { id: number; message: string; createdAt: string }[];
  predictions?: { predictionMonth: string; predictedUnits: number; predictedBill: number }[];
}
interface Monthly { month: string; units: number; weeks: number; partial: boolean }
interface Prediction { predictionMonth: string; predictedUnits: number; predictedBill: number; lowerUnits?: number; upperUnits?: number; tariffMode?: string; flatRate?: number | null; tierLimitKwh?: number; baseRatePerKwh?: number; highRatePerKwh?: number }

if (!getToken()) window.location.replace("login.html");
else document.body.hidden = false;

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const page = new URLSearchParams(window.location.search).get("page") ?? "overview";
const charts = new Map<string, any>();
let currentHistory: WeekRecord[] = [];
let calendarCursor = new Date();
calendarCursor.setDate(1);

function setText(id: string, text: string): void { $(id).textContent = text; }

const pageSections: Record<string, string[]> = {
  overview: ["summaryCard", "alert", "overviewCharts", "tipsCard", "overviewLinks"],
  usage: ["calendarCard", "historyCard"],
  insights: ["monthlyCard", "predictionCard", "alertHistoryCard", "predictionHistoryCard"],
  settings: ["settingsCard"],
};
const pageTitles: Record<string, string> = { overview: "Overview", usage: "Usage & calendar", insights: "Insights", settings: "Account settings" };
document.querySelectorAll<HTMLElement>("[data-page-section]").forEach((section) => {
  section.hidden = !(pageSections[page] ?? pageSections.overview).includes(section.dataset.pageSection ?? "");
});
setText("pageTitle", pageTitles[page] ?? pageTitles.overview);
document.querySelectorAll<HTMLAnchorElement>("[data-page-link]").forEach((link) => link.classList.toggle("active", link.dataset.pageLink === page));

function renderChart(id: string, labels: string[], values: number[], label: string, type: "line" | "bar" = "line"): void {
  const existing = charts.get(id);
  if (existing) existing.destroy();
  const color = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  charts.set(id, new Chart($(id) as HTMLCanvasElement, {
    type,
    data: { labels, datasets: [{ label, data: values, borderColor: color, backgroundColor: `${color}88`, tension: 0.25, fill: type === "line" }] },
    options: { responsive: true, scales: { y: { beginAtZero: true } } },
  }));
}

async function loadDashboard(): Promise<void> {
  const data = await api<Dashboard>("/dashboard");
  currentHistory = data.history;
  setText("avg", `${data.averageWeeklyUnits} kWh`);
  if (data.comparison) {
    const pct = data.comparison.changePercent === null ? "" : ` (${data.comparison.changePercent > 0 ? "+" : ""}${data.comparison.changePercent}%)`;
    setText("compare", `${data.comparison.current} kWh vs ${data.comparison.previous} kWh last week${pct}`);
  } else setText("compare", "Add at least two weeks to compare.");

  const alertBox = $("alert");
  alertBox.hidden = !data.alert;
  alertBox.textContent = data.alert?.message ?? "";
  $("tips").replaceChildren(...data.tips.map((tip) => Object.assign(document.createElement("li"), { textContent: tip })));
  $("alertHistory").replaceChildren(...(data.alerts ?? []).map((alert) => Object.assign(document.createElement("li"), { textContent: `${alert.createdAt}: ${alert.message}` })));
  $("predictionHistory").replaceChildren(...(data.predictions ?? []).map((prediction) => Object.assign(document.createElement("li"), { textContent: `${prediction.predictionMonth}: ${prediction.predictedUnits} kWh, ${prediction.predictedBill} SAR` })));
  renderChart("weeklyChart", data.history.slice(-12).map((week) => week.weekStart), data.history.slice(-12).map((week) => week.units), "Weekly usage (kWh)");
  renderCalendar();

  const table = $("historyRows");
  table.replaceChildren(...data.history.slice().reverse().map((record) => {
    const row = document.createElement("tr");
    const week = document.createElement("td"); week.textContent = record.weekStart;
    const units = document.createElement("td"); units.textContent = String(record.units);
    const editCell = document.createElement("td");
    const edit = document.createElement("button"); edit.textContent = "Edit"; edit.className = "btn btn-outline";
    edit.addEventListener("click", async () => {
      const value = window.prompt(`Weekly kWh for ${record.weekStart}`, String(record.units));
      if (value === null) return;
      try { await api(`/consumption/${record.weekStart}`, { method: "PUT", body: { units: value } }); await refreshViews(); }
      catch (error) { setText("entryError", error instanceof Error ? error.message : "Could not update record"); }
    });
    editCell.append(edit);
    const deleteCell = document.createElement("td");
    const remove = document.createElement("button"); remove.textContent = "Delete"; remove.className = "btn btn-outline";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Delete the week starting ${record.weekStart}?`)) return;
      try { await api(`/consumption/${record.weekStart}`, { method: "DELETE" }); await refreshViews(); }
      catch (error) { setText("entryError", error instanceof Error ? error.message : "Could not delete record"); }
    });
    deleteCell.append(remove);
    row.append(week, units, editCell, deleteCell);
    return row;
  }));
  await loadMonthly();
}

async function loadMonthly(): Promise<void> {
  const result = await api<{ months: Monthly[]; comparison: { current: Monthly; previous: Monthly; changePercent: number | null } | null; invoiceDay: number }>("/dashboard/monthly");
  $("monthlyList").replaceChildren(...result.months.map((month) => Object.assign(document.createElement("li"), { textContent: `${month.month}: ${month.units} kWh${month.partial ? ` (${month.weeks} weeks, partial)` : ""}` })));
  const comparison = result.comparison;
  setText("monthlyComparison", comparison ? `${comparison.current.month}: ${comparison.current.units} kWh, ${comparison.changePercent === null ? "change unavailable" : `${comparison.changePercent >= 0 ? "up" : "down"} ${Math.abs(comparison.changePercent)}%`} from ${comparison.previous.month}. Invoice cycle begins on day ${result.invoiceDay}.` : `Invoice cycle begins on day ${result.invoiceDay}. Add readings across multiple cycles to compare.`);
  renderChart("monthlyChart", result.months.map((month) => month.month), result.months.map((month) => month.units), "Invoice-cycle usage (kWh)", "bar");
  renderCalendar();
}

function renderCalendar(): void {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  setText("calendarMonth", calendarCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" }));
  const cells: HTMLElement[] = [];
  for (let blankCount = new Date(year, month, 1).getDay(); blankCount > 0; blankCount--) {
    const blank = document.createElement("span"); blank.className = "calendar-blank"; blank.setAttribute("aria-hidden", "true"); cells.push(blank);
  }
  for (let day = 1; day <= new Date(year, month + 1, 0).getDate(); day++) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const record = dailyEntries.find((item) => item.date === date);
    const button = document.createElement("button");
    button.type = "button"; button.className = `calendar-day${record ? " has-reading" : ""}${record?.invalidDrop ? " invalid-reading" : ""}`; button.textContent = String(day);
    const detail = record ? record.readingType === "meter_total" ? `${record.reading} kWh meter total${record.units === null ? " · needs a previous reading" : ` · ${record.units} kWh used`}` : `${record.units} kWh used` : "no reading";
    button.setAttribute("aria-label", `${date}, ${detail}`);
    button.title = `${detail} · select to edit`;
    button.setAttribute("aria-pressed", String(selectedDate === date));
    button.addEventListener("click", () => selectCalendarDate(date));
    cells.push(button);
  }
  $("calendarGrid").replaceChildren(...cells);
}

let dailyEntries: DailyRecord[] = [];
let selectedDate: string | null = null;

async function loadDailyEntries(): Promise<void> {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const end = `${year}-${String(month + 1).padStart(2, "0")}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, "0")}`;
  dailyEntries = await api<DailyRecord[]>(`/consumption/daily?start=${start}&end=${end}`);
  renderCalendar();
}

function selectCalendarDate(date: string): void {
  selectedDate = date;
  const existing = dailyEntries.find((entry) => entry.date === date);
  setText("dailyEntryTitle", `Reading for ${new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`);
  ($("dailyUnits") as HTMLInputElement).value = existing ? String(existing.reading) : "";
  ($("dailyReadingType") as HTMLSelectElement).value = existing?.readingType ?? "auto";
  updateReadingModeHelp();
  $("dailyExisting").hidden = !existing;
  $("dailyExisting").textContent = existing ? existing.readingType === "meter_total"
    ? `Total meter: ${existing.reading} kWh${existing.units === null ? " · first reading establishes your baseline" : ` · usage since ${existing.previousReadingDate}: ${existing.units} kWh`}`
    : `Daily use: ${existing.reading} kWh`
    : "No reading saved for this date yet.";
  $("dailyDelete").hidden = !existing;
  $("dailyEntryError").textContent = "";
  $("dailyEntry").hidden = false;
  renderCalendar();
  ($("dailyUnits") as HTMLInputElement).focus();
}

async function saveDailyEntry(units: number): Promise<void> {
  if (!selectedDate) return;
  const date = selectedDate;
  await api(`/consumption/daily/${date}`, { method: "PUT", body: { units, readingType: ($("dailyReadingType") as HTMLSelectElement).value } });
  await loadDailyEntries();
  selectCalendarDate(date);
}

function updateReadingModeHelp(): void {
  const mode = ($("dailyReadingType") as HTMLSelectElement).value;
  setText("dailyUnitsLabel", mode === "meter_total" ? "Total meter reading (kWh)" : mode === "auto" ? "Meter value (kWh)" : "Usage for this day (kWh)");
  setText("dailyReadingHelp", mode === "meter_total"
    ? "Enter the cumulative number shown on the meter. Usage is calculated from the previous total; your first total sets a baseline."
    : mode === "auto"
      ? "We compare this with your previous total reading. A value at or above it is treated as a meter total; a lower value is treated as daily use. For your first entry, choose daily use or meter total explicitly."
      : "Enter only the electricity used on this calendar date.");
}

$("dailyReadingType").addEventListener("change", updateReadingModeHelp);

$("calendarPrevious").addEventListener("click", () => { calendarCursor.setMonth(calendarCursor.getMonth() - 1); selectedDate = null; $("dailyEntry").hidden = true; void loadDailyEntries().catch(showCalendarError); });
$("calendarNext").addEventListener("click", () => { calendarCursor.setMonth(calendarCursor.getMonth() + 1); selectedDate = null; $("dailyEntry").hidden = true; void loadDailyEntries().catch(showCalendarError); });
$("dailyEntryClose").addEventListener("click", () => { selectedDate = null; $("dailyEntry").hidden = true; renderCalendar(); });
$("dailyEntryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("dailySave") as HTMLButtonElement;
  button.disabled = true;
  try { await saveDailyEntry(Number(($("dailyUnits") as HTMLInputElement).value)); }
  catch (error) { setText("dailyEntryError", error instanceof Error ? error.message : "Could not save daily reading"); }
  finally { button.disabled = false; }
});
$("dailyDelete").addEventListener("click", async () => {
  if (!selectedDate || !window.confirm(`Delete the reading for ${selectedDate}?`)) return;
  const date = selectedDate;
  try {
    await api(`/consumption/daily/${date}`, { method: "DELETE" });
    await loadDailyEntries();
    selectCalendarDate(date);
  } catch (error) { setText("dailyEntryError", error instanceof Error ? error.message : "Could not delete daily reading"); }
});

function showCalendarError(error: unknown): void {
  setText("dailyEntryError", error instanceof Error ? error.message : "Could not load daily readings");
}

async function loadSettings(): Promise<void> {
  const me = await api<{ fullName: string; pricePerKwh: number | null; tariffMode: string; invoiceDay: number }>("/me");
  ($("fullName") as HTMLInputElement).value = me.fullName;
  ($("pricePerKwh") as HTMLInputElement).value = me.pricePerKwh === null ? "" : String(me.pricePerKwh);
  ($("invoiceDay") as HTMLInputElement).value = String(me.invoiceDay);
  const tiered = document.querySelector<HTMLInputElement>('input[name="tariffMode"][value="tiered"]')!;
  const flat = document.querySelector<HTMLInputElement>('input[name="tariffMode"][value="flat_override"]')!;
  tiered.checked = me.tariffMode === "tiered";
  flat.checked = me.tariffMode === "flat_override";
  ($("pricePerKwh") as HTMLInputElement).disabled = !flat.checked;
}

async function refreshViews(): Promise<void> { await loadDashboard(); await loadSettings(); }

$("entryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("entryError");
  const saveButton = $("entryForm").querySelector<HTMLButtonElement>('button[type="submit"]')!;
  saveButton.disabled = true; error.textContent = "";
  try {
    await api("/consumption", { method: "POST", body: { date: ($("date") as HTMLInputElement).value, units: ($("units") as HTMLInputElement).value } });
    ($("entryForm") as HTMLFormElement).reset();
    await refreshViews();
  } catch (failure) { error.textContent = failure instanceof Error ? failure.message : "Could not save"; }
  finally { saveButton.disabled = false; }
});

$("predictBtn").addEventListener("click", async () => {
  const output = $("prediction"); output.textContent = "Calculating…";
  try {
    const prediction = await api<Prediction>("/predict", { method: "POST" });
    const tariff = prediction.tariffMode === "flat_override" ? `your flat rate of ${prediction.flatRate} SAR/kWh` : `the first ${prediction.tierLimitKwh} kWh at ${prediction.baseRatePerKwh} SAR/kWh and excess at ${prediction.highRatePerKwh} SAR/kWh`;
    output.textContent = `Next invoice cycle: about ${prediction.predictedUnits} kWh (range ${prediction.lowerUnits ?? prediction.predictedUnits} to ${prediction.upperUnits ?? prediction.predictedUnits}), estimated bill ${prediction.predictedBill} SAR using ${tariff}.`;
  } catch (error) { output.textContent = error instanceof Error ? error.message : "Prediction failed"; }
});

$("logout").addEventListener("click", () => { clearToken(); window.location.href = "index.html"; });

document.querySelectorAll<HTMLInputElement>('input[name="tariffMode"]').forEach((input) => input.addEventListener("change", () => {
  ($("pricePerKwh") as HTMLInputElement).disabled = document.querySelector<HTMLInputElement>('input[name="tariffMode"]:checked')?.value !== "flat_override";
}));

$("settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("settingsSave") as HTMLButtonElement; button.disabled = true;
  const mode = document.querySelector<HTMLInputElement>('input[name="tariffMode"]:checked')?.value;
  const flatRate = ($("pricePerKwh") as HTMLInputElement).value;
  try {
    await api("/me", { method: "PATCH", body: { fullName: ($("fullName") as HTMLInputElement).value, invoiceDay: Number(($("invoiceDay") as HTMLInputElement).value), tariffMode: mode, ...(mode === "flat_override" ? { pricePerKwh: Number(flatRate) } : {}) } });
    setText("settingsMessage", "Account and invoice settings saved.");
    await loadSettings();
  } catch (error) { setText("settingsMessage", error instanceof Error ? error.message : "Could not save settings"); }
  finally { button.disabled = false; }
});

loadDashboard().then(loadSettings).then(loadDailyEntries).catch((error) => { setText("compare", error instanceof Error ? error.message : "Could not load data"); $("loadError").hidden = false; });
