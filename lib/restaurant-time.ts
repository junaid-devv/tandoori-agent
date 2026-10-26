export interface ParsedRestaurantClock {
  hours24: number;
  minutes: number;
  totalMinutes: number;
  normalized: string;
}

export interface RestaurantTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const RESTAURANT_TIMEZONE = process.env.RESTAURANT_TIMEZONE || "Asia/Karachi";

export function getRestaurantTimeZone(): string {
  return RESTAURANT_TIMEZONE;
}

export function parseRestaurantClock(value: string): ParsedRestaurantClock | null {
  const raw = value.trim();
  const twelveHourMatch = raw.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  const twentyFourHourMatch = raw.match(/^(\d{1,2}):(\d{2})$/);

  let hours24: number | null = null;
  let minutes: number | null = null;

  if (twelveHourMatch) {
    const hours = Number.parseInt(twelveHourMatch[1], 10);
    minutes = Number.parseInt(twelveHourMatch[2], 10);
    if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;

    const period = twelveHourMatch[3].toUpperCase();
    hours24 = hours % 12;
    if (period === "PM") hours24 += 12;
  } else if (twentyFourHourMatch) {
    hours24 = Number.parseInt(twentyFourHourMatch[1], 10);
    minutes = Number.parseInt(twentyFourHourMatch[2], 10);
    if (hours24 < 0 || hours24 > 23 || minutes < 0 || minutes > 59) return null;
  } else {
    return null;
  }

  const displayHours = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const period = hours24 >= 12 ? "PM" : "AM";

  return {
    hours24,
    minutes,
    totalMinutes: hours24 * 60 + minutes,
    normalized: `${displayHours}:${String(minutes).padStart(2, "0")} ${period}`,
  };
}

export function normalizeRestaurantClock(value: string): string | null {
  return parseRestaurantClock(value)?.normalized ?? null;
}

function getTimeZoneParts(date: Date, timeZone = getRestaurantTimeZone()): RestaurantTimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const extracted = formatter.formatToParts(date).reduce<Record<string, number>>((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = Number.parseInt(part.value, 10);
    }
    return accumulator;
  }, {});

  return {
    year: extracted.year,
    month: extracted.month,
    day: extracted.day,
    hour: extracted.hour,
    minute: extracted.minute,
    second: extracted.second,
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone = getRestaurantTimeZone()): number {
  const parts = getTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

export function getRestaurantNowParts(timeZone = getRestaurantTimeZone(), date = new Date()): RestaurantTimeParts {
  return getTimeZoneParts(date, timeZone);
}

export function buildRestaurantDateTimeIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone = getRestaurantTimeZone(),
): string {
  let timestamp = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const offset = getTimeZoneOffsetMs(new Date(timestamp), timeZone);
    const nextTimestamp = Date.UTC(year, month - 1, day, hour, minute, 0, 0) - offset;
    if (nextTimestamp === timestamp) break;
    timestamp = nextTimestamp;
  }

  return new Date(timestamp).toISOString();
}

/**
 * Parses freeform customer time expressions into a valid ISO-8601 string.
 * Requires a clear time of day: 12h ("9pm", "9:30 pm"),
 * 24h ("21:00"), relative ("in 30 mins", "30 min baad", "half an hour"),
 * and direct ISO timestamps.
 */
export function parseCustomerTimeToIso(
  value: string | null | undefined,
  timeZone = getRestaurantTimeZone(),
  now = new Date(),
): string | null {
  if (!value?.trim()) return null;
  let raw = value.trim().toLowerCase();
  const future = (date: Date) => Number.isFinite(date.getTime()) && date.getTime() >= now.getTime() - 60_000 ? date.toISOString() : null;
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})$/i.test(raw)) return future(new Date(raw));
  if (/^(?:asap|now|abhi|jaldi|as soon as possible)$/i.test(raw)) return new Date(now.getTime() + 45 * 60_000).toISOString();
  if (/^(?:adha ghanta|half an hour)$/i.test(raw)) return new Date(now.getTime() + 30 * 60_000).toISOString();
  if (/^(?:one hour|ek ghanta)$/i.test(raw)) return new Date(now.getTime() + 60 * 60_000).toISOString();
  const relative = raw.match(/^(?:in\s+)?(\d+)\s*(minutes?|mins?|mnet|mnt|hours?|hrs?|ghant[ae])(?:\s+baad)?$/i);
  if (relative) {
    const minutes = Number(relative[1]) * (/^(?:h|gh)/i.test(relative[2]) ? 60 : 1);
    return minutes > 0 && minutes <= 1440 ? new Date(now.getTime() + minutes * 60_000).toISOString() : null;
  }
  const tomorrow = /\btomorrow\b|\bkal\b/i.test(raw);
  raw = raw.replace(/\b(?:today|tonight|tomorrow|aaj|kal|at)\b/gi, " ").trim();
  const parts = getTimeZoneParts(now, timeZone);
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + (tomorrow ? 1 : 0)));
  const clock = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|bje|baje|bajay|bajy)?(?:\s+tak)?$/i);
  if (!clock) return null;
  const hour = Number(clock[1]);
  const minute = Number(clock[2] ?? 0);
  const period = clock[3];
  if (minute > 59 || hour > 23 || (/^[ap]m$/i.test(period ?? "") && (hour < 1 || hour > 12))) return null;
  // A bare hour or 'baje' has no unambiguous AM/PM. Ask instead of inventing it.
  if (!period && !clock[2] || period && !/^[ap]m$/i.test(period)) return null;
  const hour24 = period ? hour % 12 + (period === "pm" ? 12 : 0) : hour;
  return future(new Date(buildRestaurantDateTimeIso(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour24, minute, timeZone)));
}
