// Business overview numbers for the home dashboard. Pure functions: data in, numbers out.
// All periods are in Toronto time. Money is before tax unless the name says otherwise.

const TZ = "America/Toronto";
const DAY = 86_400_000;

export const PERIODS = {
  today: "Today",
  week: "This week",
  month: "This month",
  "30d": "Last 30 days",
  year: "This year",
} as const;
export type PeriodKey = keyof typeof PERIODS;

/** Toronto wall-clock parts for an instant. */
function torontoParts(ms: number) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short" })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value])
  );
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second, weekday: p.weekday as string };
}

/** The UTC instant of midnight in Toronto on the given calendar day (handles DST). */
export function torontoMidnight(y: number, m: number, d: number) {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = torontoParts(t);
    const wall = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
    t = guess - (wall - t);
  }
  return t;
}

export type Bucket = { label: string; start: number; end: number };
export type Range = { key: PeriodKey; start: number; end: number; prevStart: number; prevEnd: number; buckets: Bucket[]; compareLabel: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A period part-way through (today, this week/month/year) is compared with the same
 * stretch of the previous period, e.g. Nov 1–12 vs Oct 1–12, not vs all of October.
 */
export function periodRange(key: PeriodKey, now = Date.now()): Range {
  const r = periodRangeFull(key, now);
  if (key !== "30d" && now < r.end) {
    const elapsed = now - r.start;
    r.prevEnd = Math.min(r.prevEnd, r.prevStart + elapsed);
    r.compareLabel = { today: "vs this time last week", week: "vs this point last week", month: "vs this point last month", year: "vs this point last year" }[key];
  }
  return r;
}

function periodRangeFull(key: PeriodKey, now: number): Range {
  const t = torontoParts(now);
  const today = torontoMidnight(t.y, t.m, t.d);
  const dayStart = (offsetDays: number) => {
    const p = torontoParts(today + offsetDays * DAY + 12 * 3_600_000); // noon avoids DST edges
    return torontoMidnight(p.y, p.m, p.d);
  };
  const dayBuckets = (from: number, to: number): Bucket[] => {
    const out: Bucket[] = [];
    for (let s = from; s < to; ) {
      const p = torontoParts(s + 12 * 3_600_000);
      const next = torontoMidnight(p.y, p.m, p.d + 1);
      out.push({ label: `${MONTHS[p.m - 1]} ${p.d}`, start: s, end: Math.min(next, to) });
      s = next;
    }
    return out;
  };

  if (key === "today") {
    const start = today, end = dayStart(1);
    // Chart: the last 7 days, so a single day still has context.
    return { key, start, end, prevStart: dayStart(-7), prevEnd: dayStart(-6), buckets: dayBuckets(dayStart(-6), end), compareLabel: "vs same day last week" };
  }
  if (key === "week") {
    const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(t.weekday);
    const start = dayStart(-dow), end = dayStart(7 - dow);
    return { key, start, end, prevStart: dayStart(-dow - 7), prevEnd: start, buckets: dayBuckets(start, end), compareLabel: "vs last week" };
  }
  if (key === "month") {
    const start = torontoMidnight(t.y, t.m, 1), end = torontoMidnight(t.y, t.m + 1, 1);
    return { key, start, end, prevStart: torontoMidnight(t.y, t.m - 1, 1), prevEnd: start, buckets: dayBuckets(start, end), compareLabel: "vs last month" };
  }
  if (key === "year") {
    const start = torontoMidnight(t.y, 1, 1), end = torontoMidnight(t.y + 1, 1, 1);
    const buckets = MONTHS.map((label, i) => ({ label, start: torontoMidnight(t.y, i + 1, 1), end: torontoMidnight(t.y, i + 2, 1) }));
    return { key, start, end, prevStart: torontoMidnight(t.y - 1, 1, 1), prevEnd: start, buckets, compareLabel: "vs last year" };
  }
  // last 30 days, including today
  const end = dayStart(1), start = dayStart(-29);
  return { key: "30d", start, end, prevStart: dayStart(-59), prevEnd: start, buckets: dayBuckets(start, end), compareLabel: "vs the 30 days before" };
}

/** The range as Toronto calendar dates (YYYY-MM-DD, inclusive), which is what the database reports take. */
export function rangeDates(r: Range) {
  const d = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(ms));
  return { from: d(r.start), to: d(r.end - 1), prevFrom: d(r.prevStart), prevTo: d(r.prevEnd - 1) };
}

/** % change, or null when there's nothing to compare against. */
export function change(now: number, before: number) {
  if (!before) return null;
  return Math.round(((now - before) / Math.abs(before)) * 100);
}

// ───────── Ticket numbers (money comes from the database: dashboard_money) ─────────
export type TicketRow = { id: string; status: string; created_at: string; picked_up_at: string | null; device_type: string; problem: string };

const inRange = (iso: string | null, a: number, b: number) => {
  if (!iso) return false;
  const t = Date.parse(iso);
  return t >= a && t < b;
};

export function ticketStats(range: Range, tickets: TicketRow[], open: TicketRow[], now = Date.now()) {
  const created = tickets.filter((t) => inRange(t.created_at, range.start, range.end));
  const completed = tickets.filter((t) => t.status === "picked_up" && inRange(t.picked_up_at, range.start, range.end));
  const turnaround = completed.length
    ? Math.round((completed.reduce((a, t) => a + (Date.parse(t.picked_up_at!) - Date.parse(t.created_at)), 0) / completed.length / DAY) * 10) / 10
    : null;
  const openByStatus: Record<string, number> = {};
  for (const t of open) openByStatus[t.status] = (openByStatus[t.status] ?? 0) + 1;
  const repairs: Record<string, number> = {};
  for (const t of created) {
    for (const part of (t.problem || "Other").split(",").map((s) => s.trim()).filter(Boolean)) {
      const k = `${t.device_type} · ${part}`;
      repairs[k] = (repairs[k] ?? 0) + 1;
    }
  }
  return {
    created: created.length,
    createdBefore: tickets.filter((t) => inRange(t.created_at, range.prevStart, range.prevEnd)).length,
    completed: completed.length,
    turnaround,
    openByStatus,
    overdue: open.filter((t) => now - Date.parse(t.created_at) > 7 * DAY && t.status !== "ready"),
    topRepairs: Object.entries(repairs).sort((a, b) => b[1] - a[1]).slice(0, 6),
  };
}
