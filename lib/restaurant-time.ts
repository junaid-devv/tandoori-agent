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

export function getRestaurantNowParts(timeZone = getRestaurantTimeZone()): RestaurantTimeParts {
  return getTimeZoneParts(new Date(), timeZone);
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
 * Handles Urdu ("9 bje", "9 bajay", "9:30 baje"), 12h ("9pm", "9:30 pm"),
 * 24h ("21:00"), relative ("in 30 mins", "30 min baad", "half an hour"),
 * and direct ISO timestamps.
 */
export function parseCustomerTimeToIso(
  value: string | null | undefined,
  timeZone = getRestaurantTimeZone(),
): string {
  if (!value || typeof value !== "string" || !value.trim()) {
    return new Date(Date.now() + 45 * 60_000).toISOString();
  }

  const raw = value.trim().toLowerCase();

  // 1) If already an ISO or SQL timestamp string
  if (/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/i.test(raw)) {
    const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // 2) Relative minutes: "in 30 mins", "30 min baad", "45 minutes", "adha ghanta", "half an hour", "1 hour"
  if (/adha ghanta|half an hour/i.test(raw)) {
    return new Date(Date.now() + 30 * 60_000).toISOString();
  }
  if (/1 ghanta|one hour|1 hour/i.test(raw)) {
    return new Date(Date.now() + 60 * 60_000).toISOString();
  }
  const relMinMatch = raw.match(/(\d+)\s*(?:min|mins|minute|minutes|mnet|mnt)/i);
  if (relMinMatch) {
    const mins = Number.parseInt(relMinMatch[1], 10);
    if (mins > 0 && mins <= 360) {
      return new Date(Date.now() + mins * 60_000).toISOString();
    }
  }

  const nowParts = getRestaurantNowParts(timeZone);

  // 3) Urdu clock: "9 bje", "9:30 bje", "9 bajay", "9 bajy", "9 baje", "9:00 baje"
  const urduMatch = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(?:bje|baje|bajay|bajy|bje tak|baje tak)\b/i);
  if (urduMatch) {
    const hours = Number.parseInt(urduMatch[1], 10);
    const mins = urduMatch[2] ? Number.parseInt(urduMatch[2], 10) : 0;
    let hours24 = hours;
    if (hours >= 1 && hours <= 11) {
      // In evening / restaurant context, 1-11 is PM unless specified
      hours24 = hours + 12;
    }
    return buildRestaurantDateTimeIso(nowParts.year, nowParts.month, nowParts.day, hours24 % 24, mins, timeZone);
  }

  // 4) 12-hour: "9pm", "9:30pm", "9:00 pm", "9 am"
  const twelveHourMatch = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)\b/i);
  if (twelveHourMatch) {
    const hours = Number.parseInt(twelveHourMatch[1], 10);
    const mins = twelveHourMatch[2] ? Number.parseInt(twelveHourMatch[2], 10) : 0;
    const period = twelveHourMatch[3].toUpperCase();
    let hours24 = hours % 12;
    if (period === "PM") hours24 += 12;
    return buildRestaurantDateTimeIso(nowParts.year, nowParts.month, nowParts.day, hours24 % 24, mins, timeZone);
  }

  // 5) 24-hour: "21:00", "20:30"
  const twentyFourMatch = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourMatch) {
    const hours24 = Number.parseInt(twentyFourMatch[1], 10);
    const mins = Number.parseInt(twentyFourMatch[2], 10);
    if (hours24 >= 0 && hours24 <= 23 && mins >= 0 && mins <= 59) {
      return buildRestaurantDateTimeIso(nowParts.year, nowParts.month, nowParts.day, hours24, mins, timeZone);
    }
  }

  // 6) Bare number: "9", "10", "8"
  const bareNumMatch = raw.match(/^(\d{1,2})$/);
  if (bareNumMatch) {
    const hours = Number.parseInt(bareNumMatch[1], 10);
    let hours24 = hours;
    if (hours >= 1 && hours <= 11) {
      hours24 = hours + 12;
    }
    return buildRestaurantDateTimeIso(nowParts.year, nowParts.month, nowParts.day, hours24 % 24, 0, timeZone);
  }

  // Fallback safe timestamp (+45 mins from now)
  return new Date(Date.now() + 45 * 60_000).toISOString();
}
