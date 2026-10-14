import { Router } from "express";
import { RowDataPacket } from "mysql2";
import { pool } from "../db";
import { AuthedRequest, requireAuth } from "../auth";
import { mondayOf, checkAboveAverage } from "../analytics";

export const consumptionRouter = Router();
consumptionRouter.use(requireAuth);

function validDate(date: unknown): date is string {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

// Daily calendar entries are separate from legacy weekly summaries.
consumptionRouter.get("/daily", async (req: AuthedRequest, res) => {
  const start = req.query.start;
  const end = req.query.end;
  if (!validDate(start) || !validDate(end) || start > end) return res.status(400).json({ error: "start and end must be valid dates with start on or before end" });
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT entry_date AS date, units_consumed AS reading, reading_type AS readingType FROM daily_consumption_entries
     WHERE user_id = ? AND entry_date <= ?
       AND (entry_date >= ? OR entry_date = (
         SELECT MAX(previous_entry.entry_date) FROM daily_consumption_entries previous_entry
         WHERE previous_entry.user_id = ? AND previous_entry.reading_type = 'meter_total' AND previous_entry.entry_date < ?
       ))
     ORDER BY entry_date ASC`,
    [req.userId, end, start, req.userId, start],
  );
  res.json(rows.map((row, index) => {
    const date = String(row.date).slice(0, 10);
    if (date < start) return null;
    const reading = Number(row.reading);
    const readingType = String(row.readingType) as "daily_use" | "meter_total";
    if (readingType === "daily_use") return { date, reading, readingType, units: reading, derived: false };
    const previous = rows.slice(0, index).reverse().find((candidate) => String(candidate.readingType) === "meter_total");
    if (!previous) return { date, reading, readingType, units: null, derived: true, needsBaseline: true };
    const units = reading - Number(previous.reading);
    return { date, reading, readingType, units: units >= 0 ? units : null, derived: true, previousReadingDate: String(previous.date).slice(0, 10), invalidDrop: units < 0 };
  }).filter((entry) => entry !== null));
});

consumptionRouter.put("/daily/:date", async (req: AuthedRequest, res) => {
  const date = String(req.params.date);
  const units = Number(req.body?.units);
  const requestedType = req.body?.readingType === undefined ? "auto" : req.body.readingType;
  let readingType: "daily_use" | "meter_total" | null = requestedType === "meter_total" || requestedType === "daily_use" ? requestedType : null;
  if (!validDate(date)) return res.status(400).json({ error: "date must be a valid YYYY-MM-DD date" });
  if (!Number.isFinite(units) || units < 0) return res.status(400).json({ error: "units must be a non-negative number" });
  if (requestedType !== "auto" && !readingType) return res.status(400).json({ error: "readingType must be auto, daily_use, or meter_total" });
  if (requestedType === "auto") {
    const [previousRows] = await pool.query<RowDataPacket[]>(
      "SELECT units_consumed AS reading FROM daily_consumption_entries WHERE user_id = ? AND reading_type = 'meter_total' AND entry_date < ? ORDER BY entry_date DESC LIMIT 1",
      [req.userId, date],
    );
    readingType = previousRows.length && units >= Number(previousRows[0].reading) ? "meter_total" : "daily_use";
  }
  if (readingType === "meter_total") {
    const [previousRows] = await pool.query<RowDataPacket[]>(
      "SELECT entry_date AS date, units_consumed AS reading FROM daily_consumption_entries WHERE user_id = ? AND reading_type = 'meter_total' AND entry_date < ? ORDER BY entry_date DESC LIMIT 1",
      [req.userId, date],
    );
    if (previousRows.length && units < Number(previousRows[0].reading)) return res.status(400).json({ error: `Total meter reading must be at least ${Number(previousRows[0].reading)} kWh from ${String(previousRows[0].date).slice(0, 10)}. If the meter was reset or rolled over, record that separately before continuing.` });
    const [nextRows] = await pool.query<RowDataPacket[]>(
      "SELECT entry_date AS date, units_consumed AS reading FROM daily_consumption_entries WHERE user_id = ? AND reading_type = 'meter_total' AND entry_date > ? ORDER BY entry_date ASC LIMIT 1",
      [req.userId, date],
    );
    if (nextRows.length && units > Number(nextRows[0].reading)) return res.status(400).json({ error: `Total meter reading must be no greater than ${Number(nextRows[0].reading)} kWh from ${String(nextRows[0].date).slice(0, 10)}.` });
  }
  await pool.query(
    `INSERT INTO daily_consumption_entries (user_id, entry_date, units_consumed, reading_type) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE units_consumed = VALUES(units_consumed), reading_type = VALUES(reading_type), updated_at = CURRENT_TIMESTAMP`,
    [req.userId, date, units, readingType],
  );
  let derivedUnits: number | null = readingType === "daily_use" ? units : null;
  let previousReadingDate: string | null = null;
  let needsBaseline = false;
  if (readingType === "meter_total") {
    const [previousRows] = await pool.query<RowDataPacket[]>(
      "SELECT entry_date AS date, units_consumed AS reading FROM daily_consumption_entries WHERE user_id = ? AND reading_type = 'meter_total' AND entry_date < ? ORDER BY entry_date DESC LIMIT 1",
      [req.userId, date],
    );
    if (previousRows.length) {
      derivedUnits = units - Number(previousRows[0].reading);
      previousReadingDate = String(previousRows[0].date).slice(0, 10);
    } else needsBaseline = true;
  }
  res.json({ date, reading: units, readingType, detected: requestedType === "auto", units: derivedUnits, derived: readingType === "meter_total", previousReadingDate, needsBaseline });
});

consumptionRouter.delete("/daily/:date", async (req: AuthedRequest, res) => {
  const date = String(req.params.date);
  if (!validDate(date)) return res.status(400).json({ error: "date must be a valid YYYY-MM-DD date" });
  const [result] = await pool.query("DELETE FROM daily_consumption_entries WHERE user_id = ? AND entry_date = ?", [req.userId, date]);
  if (!(result as { affectedRows?: number }).affectedRows) return res.status(404).json({ error: "Daily entry not found" });
  res.status(204).end();
});

// UC-03 Add Weekly Consumption (re-submitting the same week updates it)
consumptionRouter.post("/", async (req: AuthedRequest, res) => {
  const { date, units, billAmount } = req.body ?? {};
  const unitsNum = Number(units);
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  }
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return res.status(400).json({ error: "Invalid date" });
  if (!Number.isFinite(unitsNum) || unitsNum < 0) {
    return res.status(400).json({ error: "units must be a non-negative number" });
  }
  let bill: number | null = null;
  if (billAmount !== undefined && billAmount !== null && billAmount !== "") {
    bill = Number(billAmount);
    if (!Number.isFinite(bill) || bill < 0) {
      return res.status(400).json({ error: "billAmount must be a non-negative number" });
    }
  }
  let weekStart: string;
  try {
    weekStart = mondayOf(date);
  } catch {
    return res.status(400).json({ error: "Invalid date" });
  }
  await pool.query(
    `INSERT INTO consumption_records (user_id, week_start, units_consumed, bill_amount)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE units_consumed = VALUES(units_consumed), bill_amount = VALUES(bill_amount)`,
    [req.userId, weekStart, unitsNum, bill],
  );
  const [historyRows] = await pool.query<RowDataPacket[]>(
    "SELECT week_start AS weekStart, units_consumed AS units FROM consumption_records WHERE user_id = ? ORDER BY week_start ASC",
    [req.userId],
  );
  const history = historyRows.map((row) => ({ weekStart: String(row.weekStart).slice(0, 10), units: Number(row.units) }));
  const alert = checkAboveAverage(history);
  if (alert) await pool.query(
    `INSERT INTO alerts (user_id, alert_type, message) SELECT ?, ?, ? FROM DUAL
     WHERE NOT EXISTS (SELECT 1 FROM alerts WHERE user_id = ? AND message = ?)`,
    [req.userId, alert.type, alert.message, req.userId, alert.message],
  );
  else await pool.query("DELETE FROM alerts WHERE user_id = ? AND alert_type = 'ABOVE_AVERAGE'", [req.userId]);
  res.status(201).json({ weekStart, units: unitsNum });
});

// History, oldest first
consumptionRouter.get("/", async (req: AuthedRequest, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT week_start AS weekStart, units_consumed AS units, bill_amount AS billAmount
     FROM consumption_records WHERE user_id = ? ORDER BY week_start ASC`,
    [req.userId],
  );
  res.json(rows.map((r) => ({ ...r, units: Number(r.units), billAmount: r.billAmount === null ? null : Number(r.billAmount) })));
});

consumptionRouter.put("/:weekStart", async (req: AuthedRequest, res) => {
  const weekStart = String(req.params.weekStart);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return res.status(400).json({ error: "weekStart must be YYYY-MM-DD" });
  try { if (mondayOf(weekStart) !== weekStart) return res.status(400).json({ error: "weekStart must be a Monday" }); } catch { return res.status(400).json({ error: "Invalid date" }); }
  const units = Number(req.body?.units);
  if (!Number.isFinite(units) || units < 0) return res.status(400).json({ error: "units must be a non-negative number" });
  const rawBill = req.body?.billAmount;
  const bill = rawBill === undefined || rawBill === null || rawBill === "" ? null : Number(rawBill);
  if (bill !== null && (!Number.isFinite(bill) || bill < 0)) return res.status(400).json({ error: "billAmount must be a non-negative number" });
  const [existing] = await pool.query<RowDataPacket[]>("SELECT record_id FROM consumption_records WHERE user_id = ? AND week_start = ?", [req.userId, weekStart]);
  if (!existing.length) return res.status(404).json({ error: "Weekly record not found" });
  await pool.query("UPDATE consumption_records SET units_consumed = ?, bill_amount = ? WHERE user_id = ? AND week_start = ?", [units, bill, req.userId, weekStart]);
  await refreshAlertState(Number(req.userId));
  res.json({ weekStart, units, billAmount: bill });
});

consumptionRouter.delete("/:weekStart", async (req: AuthedRequest, res) => {
  const weekStart = String(req.params.weekStart);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return res.status(400).json({ error: "weekStart must be YYYY-MM-DD" });
  try { if (mondayOf(weekStart) !== weekStart) return res.status(400).json({ error: "weekStart must be a Monday" }); } catch { return res.status(400).json({ error: "Invalid date" }); }
  const [existing] = await pool.query<RowDataPacket[]>("SELECT record_id FROM consumption_records WHERE user_id = ? AND week_start = ?", [req.userId, weekStart]);
  if (!existing.length) return res.status(404).json({ error: "Weekly record not found" });
  await pool.query("DELETE FROM consumption_records WHERE user_id = ? AND week_start = ?", [req.userId, weekStart]);
  await refreshAlertState(Number(req.userId));
  res.status(204).end();
});

async function refreshAlertState(userId: number): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT week_start AS weekStart, units_consumed AS units FROM consumption_records WHERE user_id = ? ORDER BY week_start ASC", [userId]);
  const history = rows.map((row) => ({ weekStart: String(row.weekStart).slice(0, 10), units: Number(row.units) }));
  const alert = checkAboveAverage(history);
  await pool.query("DELETE FROM alerts WHERE user_id = ? AND alert_type = 'ABOVE_AVERAGE'", [userId]);
  if (alert) await pool.query("INSERT INTO alerts (user_id, alert_type, message) VALUES (?, ?, ?)", [userId, alert.type, alert.message]);
}
