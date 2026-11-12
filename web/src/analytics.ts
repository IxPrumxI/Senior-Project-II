// Pure analytics helpers (no I/O) so they are easy to unit-test.

export interface WeekRecord {
  weekStart: string; // YYYY-MM-DD (Monday)
  units: number;     // kWh
}

/** Returns the Monday (YYYY-MM-DD) of the week containing the given date string. */
export function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  const day = d.getUTCDay();            // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

export interface Comparison {
  current: number;
  previous: number;
  change: number;        // kWh
  changePercent: number | null; // null when previous is 0
}

/** Compares the latest week with the one before it (records oldest first). */
export function compareLastTwoWeeks(records: WeekRecord[]): Comparison | null {
  if (records.length < 2) return null;
  const current = records[records.length - 1].units;
  const previous = records[records.length - 2].units;
  return {
    current,
    previous,
    change: round2(current - previous),
    changePercent: previous === 0 ? null : round2(((current - previous) / previous) * 100),
  };
}

export const ALERT_FACTOR = 1.2; // alert when usage is 20% above the user's average
export const MIN_HISTORY_FOR_ALERT = 3;

export interface AlertResult {
  type: "ABOVE_AVERAGE";
  message: string;
}

/** Checks whether the latest week exceeds the average of the earlier weeks. */
export function checkAboveAverage(records: WeekRecord[]): AlertResult | null {
  if (records.length < MIN_HISTORY_FOR_ALERT + 1) return null;
  const latest = records[records.length - 1];
  const avg = average(records.slice(0, -1).map((r) => r.units));
  if (avg > 0 && latest.units > avg * ALERT_FACTOR) {
    const pct = Math.round(((latest.units - avg) / avg) * 100);
    return {
      type: "ABOVE_AVERAGE",
      message: `Usage for the week of ${latest.weekStart} (${latest.units} kWh) is ${pct}% above your average of ${round2(avg)} kWh.`,
    };
  }
  return null;
}

export function energySavingTips(records: WeekRecord[], month = new Date().getUTCMonth() + 1): string[] {
  if (!records.length) return ["Add a few weeks of readings to receive advice tailored to your usage."];
  const tips: string[] = [];
  const recent = records.slice(-4);
  const baseline = records.slice(0, -4);
  const recentAverage = average(recent.map((record) => record.units));
  const baselineAverage = average(baseline.map((record) => record.units));

  if (baseline.length >= 4 && baselineAverage > 0 && recentAverage > baselineAverage * 1.2) {
    const increase = Math.round((recentAverage - baselineAverage) / baselineAverage * 100);
    tips.push(`Your average weekly use over the last ${recent.length} weeks is ${increase}% above your earlier average. Check whether air conditioning or water heating has been running longer.`);
  }

  const highest = [...records].sort((a, b) => b.units - a.units)[0];
  const typical = average(records.map((record) => record.units));
  if (records.length >= 3 && highest.units > typical * 1.35) {
    tips.push(`The week starting ${highest.weekStart} was your highest at ${highest.units} kWh. Compare your appliance use that week with a typical week to find what changed.`);
  }

  if (month >= 6 && month <= 9) tips.push("During the summer, set the air conditioner to 24°C or higher and keep doors and windows closed.");
  tips.push("Switch off lights and appliances in rooms nobody is using.");
  tips.push("Unplug chargers and devices on standby.");
  return tips;
}

export interface MonthlyRecord { month: string; units: number; weeks: number; partial: boolean }

/** Returns the invoice cycle with the given start date, formatted YYYY-MM-DD. */
export function invoiceMonthOf(date: string, invoiceDay: number): string {
  const day = Number(date.slice(8, 10));
  const value = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(value.getTime()) || !Number.isInteger(invoiceDay) || invoiceDay < 1 || invoiceDay > 28) throw new Error("Invalid invoice date");
  if (day < invoiceDay) value.setUTCMonth(value.getUTCMonth() - 1);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(invoiceDay).padStart(2, "0")}`;
}

export function groupMonthly(records: WeekRecord[], invoiceDay = 1): MonthlyRecord[] {
  const groups = new Map<string, { units: number; weeks: number }>();
  for (const record of records) {
    const month = invoiceMonthOf(record.weekStart, invoiceDay);
    const value = groups.get(month) ?? { units: 0, weeks: 0 };
    value.units += record.units;
    value.weeks += 1;
    groups.set(month, value);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({
    month: month.slice(0, 7), units: round2(value.units), weeks: value.weeks, partial: value.weeks < 4,
  }));
}

export function monthComparison(months: MonthlyRecord[]): { current: MonthlyRecord; previous: MonthlyRecord; changePercent: number | null } | null {
  if (months.length < 2) return null;
  const current = months[months.length - 1];
  const previous = months[months.length - 2];
  return { current, previous, changePercent: previous.units === 0 ? null : round2((current.units - previous.units) / previous.units * 100) };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
