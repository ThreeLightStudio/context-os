const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function utcTimestamp(parts: DateParts): number {
  const value = new Date(0);
  value.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  value.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return value.getTime();
}

function dateParts(value: string): { year: number; month: number; day: number } | undefined {
  const match = DATE_PATTERN.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) return undefined;
  return { year, month, day };
}

export function isValidCalendarDate(value: string): boolean {
  return dateParts(value) !== undefined;
}

export function isValidTimeZone(value: string): boolean {
  if (value.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "iso8601",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function partsAt(instant: number, timeZone: string): DateParts {
  const parts = formatter(timeZone).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, Number(value)]));
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function offsetAt(instant: number, timeZone: string): number {
  return utcTimestamp(partsAt(instant, timeZone)) - instant;
}

function localMidnight(parts: { year: number; month: number; day: number }, timeZone: string): Date {
  const wallClock = utcTimestamp({ ...parts, hour: 0, minute: 0, second: 0 });
  let instant = wallClock;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const next = wallClock - offsetAt(instant, timeZone);
    if (next === instant) return new Date(next);
    instant = next;
  }
  return new Date(instant);
}

export interface LocalDateRange {
  start: Date;
  end: Date;
}

export function getLocalDateRange(date: string, timeZone: string): LocalDateRange {
  const parts = dateParts(date);
  if (!parts) throw new RangeError("date must be a valid YYYY-MM-DD calendar date");
  if (!isValidTimeZone(timeZone)) throw new RangeError("timezone must be a valid IANA timezone");

  const nextDay = new Date(`${date}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextParts = {
    year: nextDay.getUTCFullYear(),
    month: nextDay.getUTCMonth() + 1,
    day: nextDay.getUTCDate(),
  };
  return {
    start: localMidnight(parts, timeZone),
    end: localMidnight(nextParts, timeZone),
  };
}
