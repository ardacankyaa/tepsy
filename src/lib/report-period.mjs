export const BUSINESS_TIME_ZONE = "Europe/Istanbul";

const ALLOWED_PERIODS = new Set(["today", "yesterday", "this_week", "this_month", "all"]);
export class ReportPeriodError extends Error {
  constructor(message = "Report period is invalid.") {
    super(message);
    this.name = "ReportPeriodError";
    this.code = "invalid-report-range";
  }
}

function createFormatter(timeZone) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new ReportPeriodError("Restaurant time zone is invalid.");
  }
}

function localParts(date, formatter) {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function localToUtc(
  { year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0 },
  formatter
) {
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  let guess = localAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const formatted = localParts(new Date(guess), formatter);
    const representedAsUtc = Date.UTC(
      formatted.year,
      formatted.month - 1,
      formatted.day,
      formatted.hour,
      formatted.minute,
      formatted.second
    );
    const offset = representedAsUtc - Math.floor(guess / 1000) * 1000;
    guess = localAsUtc - offset;
  }
  return new Date(guess);
}

function addCalendarDays({ year, month, day }, amount) {
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function dayStart(parts, formatter) {
  return localToUtc({ ...parts, hour: 0, minute: 0, second: 0, millisecond: 0 }, formatter);
}

function dayEnd(parts, formatter) {
  const nextDay = addCalendarDays(parts, 1);
  return new Date(dayStart(nextDay, formatter).getTime() - 1);
}

function parseCustomDate(value, isEnd, formatter) {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const parts = {
      year: Number(dateOnly[1]),
      month: Number(dateOnly[2]),
      day: Number(dateOnly[3]),
    };
    const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    if (
      check.getUTCFullYear() !== parts.year ||
      check.getUTCMonth() + 1 !== parts.month ||
      check.getUTCDate() !== parts.day
    ) {
      throw new ReportPeriodError();
    }
    return isEnd ? dayEnd(parts, formatter) : dayStart(parts, formatter);
  }

  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    throw new ReportPeriodError("Custom date-time values must include a timezone.");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ReportPeriodError();
  return date;
}

export function resolveReportPeriod({
  period = "today",
  now = new Date(),
  timeZone = BUSINESS_TIME_ZONE,
  startDateParam,
  endDateParam,
} = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new ReportPeriodError();
  const formatter = createFormatter(timeZone);

  const hasStart = startDateParam !== undefined && startDateParam !== null;
  const hasEnd = endDateParam !== undefined && endDateParam !== null;
  if (hasStart || hasEnd) {
    if (!hasStart || !hasEnd) throw new ReportPeriodError("Both custom range dates are required.");
    const start = parseCustomDate(startDateParam, false, formatter);
    const end = parseCustomDate(endDateParam, true, formatter);
    if (start.getTime() > end.getTime())
      throw new ReportPeriodError("Start date must not follow end date.");
    return { start, end };
  }

  if (!ALLOWED_PERIODS.has(period)) throw new ReportPeriodError("Report period is not supported.");
  const today = localParts(now, formatter);
  const todayDate = { year: today.year, month: today.month, day: today.day };
  if (period === "today")
    return { start: dayStart(todayDate, formatter), end: dayEnd(todayDate, formatter) };
  if (period === "yesterday") {
    const yesterday = addCalendarDays(todayDate, -1);
    return { start: dayStart(yesterday, formatter), end: dayEnd(yesterday, formatter) };
  }
  if (period === "this_week") {
    const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
    const daysSinceMonday = (weekday + 6) % 7;
    const monday = addCalendarDays(todayDate, -daysSinceMonday);
    return { start: dayStart(monday, formatter), end: dayEnd(todayDate, formatter) };
  }
  if (period === "this_month") {
    const firstDay = { year: today.year, month: today.month, day: 1 };
    const nextMonth =
      today.month === 12
        ? { year: today.year + 1, month: 1, day: 1 }
        : { year: today.year, month: today.month + 1, day: 1 };
    return {
      start: dayStart(firstDay, formatter),
      end: new Date(dayStart(nextMonth, formatter).getTime() - 1),
    };
  }

  const firstDay = { year: 2020, month: 1, day: 1 };
  const finalDay = { year: 2099, month: 12, day: 31 };
  return { start: dayStart(firstDay, formatter), end: dayEnd(finalDay, formatter) };
}
