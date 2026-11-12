import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

process.env.DB_NAME ??= "smart_electricity_test";
process.env.DB_HOST ??= "127.0.0.1";
process.env.JWT_SECRET ??= "test-only-secret-at-least-32-characters";
if (process.env.DB_NAME !== "smart_electricity_test") throw new Error("API tests require DB_NAME=smart_electricity_test");
if (process.env.RUN_API_INTEGRATION !== "1") {
  test("UC-00: API integration suite skipped (set RUN_API_INTEGRATION=1 with test database)", { skip: true }, () => {});
} else {

const { app } = require("../app") as typeof import("../app");
const { pool } = require("../db") as typeof import("../db");
const { AppDataSource } = require("../data-source") as typeof import("../data-source");
let token = "";
const email = `test-${Date.now()}@example.com`;

test("UC-00: API integration suite (test DB only)", async (suite) => {
  await suite.test("UC-00: database name guard", () => assert.equal(process.env.DB_NAME, "smart_electricity_test"));
  await suite.test("UC-01: registration validation and success", async () => {
    assert.equal((await request(app).post("/api/auth/register").send({ email: "bad", password: "password123" })).status, 400);
    assert.equal((await request(app).post("/api/auth/register").send({ email, password: "short" })).status, 400);
    const response = await request(app).post("/api/auth/register").send({ email, password: "password123", fullName: "Test User" });
    assert.equal(response.status, 201); token = response.body.token;
  });
  await suite.test("UC-01: duplicate email returns 409", async () => assert.equal((await request(app).post("/api/auth/register").send({ email, password: "password123" })).status, 409));
  await suite.test("UC-02: login errors do not reveal whether email exists", async () => {
    const wrong = await request(app).post("/api/auth/login").send({ email, password: "wrongpassword" });
    const missing = await request(app).post("/api/auth/login").send({ email: "missing@example.com", password: "wrongpassword" });
    assert.equal(wrong.status, 401); assert.equal(wrong.body.error, missing.body.error);
    assert.equal((await request(app).post("/api/auth/login").send({ email, password: "password123" })).status, 200);
  });
  await suite.test("UC-03: protected write normalizes to Monday and rejects negative units", async () => {
    assert.equal((await request(app).post("/api/consumption").send({ date: "2026-10-07", units: 120 })).status, 401);
    assert.equal((await request(app).post("/api/consumption").set("Authorization", `Bearer ${token}`).send({ date: "2026-10-07", units: -1 })).status, 400);
    const response = await request(app).post("/api/consumption").set("Authorization", `Bearer ${token}`).send({ date: "2026-10-07", units: 120 });
    assert.equal(response.status, 201); assert.equal(response.body.weekStart, "2026-10-05");
  });
  await suite.test("UC-03: duplicate week updates the existing row", async () => {
    await request(app).post("/api/consumption").set("Authorization", `Bearer ${token}`).send({ date: "2026-10-08", units: 135 });
    const [rows] = await pool.query<any[]>("SELECT units_consumed FROM consumption_records WHERE user_id = (SELECT user_id FROM users WHERE email = ?) AND week_start = '2026-10-05'", [email]);
    assert.equal(rows.length, 1); assert.equal(Number(rows[0].units_consumed), 135);
  });
  await suite.test("UC-03: invalid date and foreign delete are rejected", async () => {
    assert.equal((await request(app).post("/api/consumption").set("Authorization", `Bearer ${token}`).send({ date: "2026-02-31", units: 3 })).status, 400);
    const other = await request(app).post("/api/auth/register").send({ email: `foreign-${Date.now()}@example.com`, password: "password123" });
    assert.equal((await request(app).delete("/api/consumption/2026-10-05").set("Authorization", `Bearer ${other.body.token}`)).status, 404);
  });
  await suite.test("UC-03: daily calendar entries can be created, edited, listed by month, and deleted", async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const created = await request(app).put("/api/consumption/daily/2026-10-14").set(auth).send({ units: 8.25, readingType: "daily_use" });
    assert.equal(created.status, 200); assert.equal(created.body.units, 8.25); assert.equal(created.body.derived, false);
    const updated = await request(app).put("/api/consumption/daily/2026-10-14").set(auth).send({ units: 9.5, readingType: "daily_use" });
    assert.equal(updated.status, 200); assert.equal(updated.body.units, 9.5);
    const firstAuto = await request(app).put("/api/consumption/daily/2026-10-13").set(auth).send({ units: 5 });
    assert.equal(firstAuto.status, 200); assert.equal(firstAuto.body.readingType, "daily_use"); assert.equal(firstAuto.body.detected, true);
    const firstTotal = await request(app).put("/api/consumption/daily/2026-10-15").set(auth).send({ units: 1000, readingType: "meter_total" });
    assert.equal(firstTotal.status, 200); assert.equal(firstTotal.body.units, null); assert.equal(firstTotal.body.needsBaseline, true);
    const nextTotal = await request(app).put("/api/consumption/daily/2026-10-16").set(auth).send({ units: 1007.5 });
    assert.equal(nextTotal.status, 200); assert.equal(nextTotal.body.readingType, "meter_total"); assert.equal(nextTotal.body.detected, true); assert.equal(nextTotal.body.units, 7.5); assert.equal(nextTotal.body.previousReadingDate, "2026-10-15");
    assert.equal((await request(app).put("/api/consumption/daily/2026-10-17").set(auth).send({ units: 10, readingType: "meter_total" })).status, 400);
    const month = await request(app).get("/api/consumption/daily?start=2026-10-01&end=2026-10-31").set(auth);
    assert.equal(month.status, 200);
    assert.deepEqual(month.body.filter((entry: { date: string }) => ["2026-10-14", "2026-10-15", "2026-10-16"].includes(entry.date)), [
      { date: "2026-10-14", reading: 9.5, readingType: "daily_use", units: 9.5, derived: false },
      { date: "2026-10-15", reading: 1000, readingType: "meter_total", units: null, derived: true, needsBaseline: true },
      { date: "2026-10-16", reading: 1007.5, readingType: "meter_total", units: 7.5, derived: true, previousReadingDate: "2026-10-15", invalidDrop: false },
    ]);
    const dashboard = await request(app).get("/api/dashboard").set(auth);
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.history.find((week: { weekStart: string }) => week.weekStart === "2026-10-12").units, 22);
    const followingMonth = await request(app).get("/api/consumption/daily?start=2026-11-01&end=2026-11-30").set(auth);
    assert.equal(followingMonth.status, 200);
    assert.equal(followingMonth.body.length, 0);
    assert.equal((await request(app).delete("/api/consumption/daily/2026-10-14").set(auth)).status, 204);
    assert.equal((await request(app).delete("/api/consumption/daily/2026-10-14").set(auth)).status, 404);
    assert.equal((await request(app).put("/api/consumption/daily/2026-02-30").set(auth).send({ units: 1 })).status, 400);
  });
  await suite.test("UC-04: dashboard read is side-effect free and unknown route is 404", async () => {
    const [beforeRows] = await pool.query<any[]>("SELECT alert_id FROM alerts");
    assert.equal((await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`)).status, 200);
    const [afterRows] = await pool.query<any[]>("SELECT alert_id FROM alerts");
    assert.equal(beforeRows.length, afterRows.length);
    assert.equal((await request(app).get("/api/not-a-route").set("Authorization", `Bearer ${token}`)).status, 404);
  });
  await suite.test("UC-04: settings are isolated to the authenticated account", async () => {
    const other = await request(app).post("/api/auth/register").send({ email: `settings-${Date.now()}@example.com`, password: "password123" });
    await request(app).patch("/api/me").set("Authorization", `Bearer ${token}`).send({ fullName: "Owned Name", pricePerKwh: 0.3 });
    const theirs = await request(app).get("/api/me").set("Authorization", `Bearer ${other.body.token}`);
    assert.notEqual(theirs.body.fullName, "Owned Name"); assert.notEqual(theirs.body.pricePerKwh, 0.3);
  });
  await suite.test("UC-04: account tariff and name validation", async () => {
    assert.equal((await request(app).patch("/api/me").set("Authorization", `Bearer ${token}`).send({ fullName: "Test", tariffMode: "flat_override", pricePerKwh: 0 })).status, 400);
    const ok = await request(app).patch("/api/me").set("Authorization", `Bearer ${token}`).send({ fullName: "Test Name", tariffMode: "flat_override", pricePerKwh: 0.25 });
    assert.equal(ok.status, 200); assert.equal(ok.body.pricePerKwh, 0.25);
    const tiered = await request(app).patch("/api/me").set("Authorization", `Bearer ${token}`).send({ fullName: "Test Name", tariffMode: "tiered" });
    assert.equal(tiered.body.tariffMode, "tiered");
    const flat = await request(app).patch("/api/me").set("Authorization", `Bearer ${token}`).send({ fullName: "Test Name", tariffMode: "flat_override", pricePerKwh: 0.25 });
    assert.equal(flat.body.tariffMode, "flat_override"); assert.equal(flat.body.pricePerKwh, 0.25);
  });
  await suite.test("UC-04: invoice day validation and saved account preference", async () => {
    const invalid = await request(app).patch("/api/me").set("Authorization", `Bearer ${token}`).send({ fullName: "Test Name", invoiceDay: 29 });
    assert.equal(invalid.status, 400);
    const saved = await request(app).patch("/api/me").set("Authorization", `Bearer ${token}`).send({ fullName: "Test Name", tariffMode: "tiered", invoiceDay: 15 });
    assert.equal(saved.status, 200); assert.equal(saved.body.invoiceDay, 15);
    const profile = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    assert.equal(profile.body.invoiceDay, 15);
  });
  await suite.test("UC-04: invalid flat tariff mode is rejected", async () => {
    const response = await request(app).patch("/api/me").set("Authorization", `Bearer ${token}`).send({ fullName: "Test Name", tariffMode: "unknown" });
    assert.equal(response.status, 400);
  });
  await suite.test("UC-04: monthly endpoint responds with grouped totals", async () => {
    const response = await request(app).get("/api/dashboard/monthly").set("Authorization", `Bearer ${token}`);
    assert.equal(response.status, 200); assert.ok(Array.isArray(response.body.months));
  });
  await pool.end();
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
});
}
