const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export function normalizeAvailabilityDays(value: unknown): WeekdayKey[] {
  if (!Array.isArray(value)) return [];
  const normalized = new Set<WeekdayKey>();
  for (const entry of value) {
    const key = String(entry ?? "").trim().slice(0, 3).toLowerCase();
    if (WEEKDAY_KEYS.includes(key as WeekdayKey)) {
      normalized.add(key as WeekdayKey);
    }
  }
  return [...normalized];
}

export function normalizeAvailabilityTime(value: unknown): string | null {
  const text = String(value ?? "").trim();
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function getMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = normalizeAvailabilityTime(value);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function getWeekdayKey(now: Date, timeZone?: string): WeekdayKey {
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: timeZone || undefined,
  })
    .format(now)
    .slice(0, 3)
    .toLowerCase();
  return WEEKDAY_KEYS.includes(weekday as WeekdayKey) ? (weekday as WeekdayKey) : "mon";
}

function getLocalMinutes(now: Date, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timeZone || undefined,
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function isMenuScheduleAvailable(input: {
  isAvailable?: boolean | null;
  availableDays?: unknown;
  availableStartTime?: string | null;
  availableEndTime?: string | null;
  now?: Date;
  timeZone?: string;
}) {
  if (input.isAvailable === false) return false;

  const now = input.now ?? new Date();
  const days = normalizeAvailabilityDays(input.availableDays);
  if (days.length > 0 && !days.includes(getWeekdayKey(now, input.timeZone))) {
    return false;
  }

  const start = getMinutes(input.availableStartTime);
  const end = getMinutes(input.availableEndTime);
  if (start == null || end == null || start === end) return true;

  const current = getLocalMinutes(now, input.timeZone);
  if (start < end) {
    return current >= start && current <= end;
  }

  return current >= start || current <= end;
}
