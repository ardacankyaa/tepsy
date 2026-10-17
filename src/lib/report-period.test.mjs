import test from "node:test";
import assert from "node:assert/strict";
import { resolveReportPeriod } from "./report-period.mjs";

test("today uses Europe/Istanbul business-day boundaries", () => {
  const { start, end } = resolveReportPeriod({
    period: "today",
    now: new Date("2026-09-24T00:30:00.000Z"),
  });

  assert.equal(start.toISOString(), "2026-09-23T21:00:00.000Z");
  assert.equal(end.toISOString(), "2026-09-24T20:59:59.999Z");
});

test("this week begins Monday in the business timezone", () => {
  const { start, end } = resolveReportPeriod({
    period: "this_week",
    now: new Date("2026-09-24T12:00:00.000Z"),
  });

  assert.equal(start.toISOString(), "2026-09-20T21:00:00.000Z");
  assert.equal(end.toISOString(), "2026-09-24T20:59:59.999Z");
});

test("date-only custom ranges include whole Istanbul calendar days", () => {
  const { start, end } = resolveReportPeriod({
    period: "today",
    startDateParam: "2026-09-24",
    endDateParam: "2026-09-25",
  });

  assert.equal(start.toISOString(), "2026-09-23T21:00:00.000Z");
  assert.equal(end.toISOString(), "2026-09-25T20:59:59.999Z");
});

test("configured time zone changes business-day boundaries and invalid zones are rejected", () => {
  const { start, end } = resolveReportPeriod({
    period: "today",
    now: new Date("2026-07-14T12:00:00.000Z"),
    timeZone: "Europe/London",
  });
  assert.equal(start.toISOString(), "2026-07-13T23:00:00.000Z");
  assert.equal(end.toISOString(), "2026-07-14T22:59:59.999Z");
  assert.throws(() => resolveReportPeriod({ period: "today", timeZone: "Not/A-Timezone" }), {
    code: "invalid-report-range",
  });
});

test("invalid or reversed report ranges are rejected", () => {
  assert.throws(
    () => resolveReportPeriod({ period: "today", startDateParam: "", endDateParam: null }),
    { code: "invalid-report-range" }
  );
  assert.throws(
    () =>
      resolveReportPeriod({
        period: "today",
        startDateParam: "not-a-date",
        endDateParam: "2026-09-25",
      }),
    { code: "invalid-report-range" }
  );

  assert.throws(
    () =>
      resolveReportPeriod({
        period: "today",
        startDateParam: "2026-09-26",
        endDateParam: "2026-09-25",
      }),
    { code: "invalid-report-range" }
  );
});
