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

// ───────── Inputs (shapes of the rows the page loads) ─────────
export type InvoiceRow = {
  created_at: string;
  status: string;
  subtotal: number | string;
  discount: number | string;
  tax: number | string;
  total: number | string;
  paid: number | string;
  invoice_items: { qty: number | string; unit_cost: number | string | null }[] | null;
  tickets: { technician_id: string | null } | null;
};
export type PaymentRow = { created_at: string; method: string; amount: number | string };
export type TicketRow = {
  id: string;
  status: string;
  created_at: string;
  picked_up_at: string | null;
  technician_id: string | null;
  device_type: string;
  problem: string;
};

const n = (v: unknown) => Number(v) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;
const inRange = (iso: string | null, a: number, b: number) => {
  if (!iso) return false;
  const t = Date.parse(iso);
  return t >= a && t < b;
};

function money(inv: InvoiceRow) {
  const revenue = n(inv.subtotal) - n(inv.discount);
  const cogs = (inv.invoice_items ?? []).reduce((a, i) => a + n(i.qty) * n(i.unit_cost), 0);
  return { revenue, cogs, tax: n(inv.tax) };
}

function sums(invoices: InvoiceRow[], a: number, b: number) {
  const list = invoices.filter((i) => i.status !== "void" && inRange(i.created_at, a, b));
  let revenue = 0, cogs = 0, tax = 0;
  for (const inv of list) {
    const m = money(inv);
    revenue += m.revenue;
    cogs += m.cogs;
    tax += m.tax;
  }
  return { revenue: r2(revenue), cogs: r2(cogs), profit: r2(revenue - cogs), tax: r2(tax), count: list.length };
}

/** % change, or null when there's nothing to compare against. */
export function change(now: number, before: number) {
  if (!before) return null;
  return Math.round(((now - before) / Math.abs(before)) * 100);
}

export function buildDashboard(
  range: Range,
  data: { invoices: InvoiceRow[]; payments: PaymentRow[]; tickets: TicketRow[]; openTickets: TicketRow[]; receivable: { total: number | string; paid: number | string }[] },
  now = Date.now()
) {
  const cur = sums(data.invoices, range.start, range.end);
  const prev = sums(data.invoices, range.prevStart, range.prevEnd);

  // Chart series
  const series = range.buckets.map((b) => {
    const s = sums(data.invoices, b.start, b.end);
    return { label: b.label, revenue: s.revenue, profit: s.profit, count: s.count, future: b.start > now };
  });

  // Payments taken in the period, by method (refunds are negative amounts)
  const byMethod: Record<string, number> = {};
  let refunds = 0;
  for (const p of data.payments) {
    if (!inRange(p.created_at, range.start, range.end)) continue;
    byMethod[p.method] = r2((byMethod[p.method] ?? 0) + n(p.amount));
    if (n(p.amount) < 0) refunds += -n(p.amount);
  }
  const collected = r2(Object.values(byMethod).reduce((a, v) => a + v, 0));

  // Tickets
  const created = data.tickets.filter((t) => inRange(t.created_at, range.start, range.end));
  const completed = data.tickets.filter((t) => t.status === "picked_up" && inRange(t.picked_up_at, range.start, range.end));
  const turnaround = completed.length
    ? Math.round((completed.reduce((a, t) => a + (Date.parse(t.picked_up_at!) - Date.parse(t.created_at)), 0) / completed.length / DAY) * 10) / 10
    : null;
  const openByStatus: Record<string, number> = {};
  for (const t of data.openTickets) openByStatus[t.status] = (openByStatus[t.status] ?? 0) + 1;
  const overdue = data.openTickets.filter((t) => now - Date.parse(t.created_at) > 7 * DAY && t.status !== "ready");
  const notPickedUp = data.openTickets.filter((t) => t.status === "ready");

  // Technicians: repairs finished in the period + revenue on their tickets' invoices
  const techs: Record<string, { completed: number; revenue: number }> = {};
  for (const t of completed) {
    const k = t.technician_id ?? "none";
    techs[k] = techs[k] ?? { completed: 0, revenue: 0 };
    techs[k].completed += 1;
  }
  for (const inv of data.invoices) {
    if (inv.status === "void" || !inRange(inv.created_at, range.start, range.end) || !inv.tickets) continue;
    const k = inv.tickets.technician_id ?? "none";
    techs[k] = techs[k] ?? { completed: 0, revenue: 0 };
    techs[k].revenue = r2(techs[k].revenue + money(inv).revenue);
  }

  // Most common repairs checked in during the period
  const repairs: Record<string, number> = {};
  for (const t of created) {
    for (const part of (t.problem || "Other").split(",").map((s) => s.trim()).filter(Boolean)) {
      const k = `${t.device_type} · ${part}`;
      repairs[k] = (repairs[k] ?? 0) + 1;
    }
  }
  const topRepairs = Object.entries(repairs).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const owed = r2(data.receivable.reduce((a, i) => a + Math.max(0, n(i.total) - n(i.paid)), 0));

  return {
    revenue: cur.revenue,
    revenueChange: change(cur.revenue, prev.revenue),
    cogs: cur.cogs,
    profit: cur.profit,
    profitChange: change(cur.profit, prev.profit),
    margin: cur.revenue ? Math.round((cur.profit / cur.revenue) * 100) : null,
    tax: cur.tax,
    invoiceCount: cur.count,
    avgSale: cur.count ? r2(cur.revenue / cur.count) : 0,
    collected,
    byMethod,
    refunds: r2(refunds),
    series,
    created: created.length,
    createdChange: change(created.length, data.tickets.filter((t) => inRange(t.created_at, range.prevStart, range.prevEnd)).length),
    completed: completed.length,
    turnaround,
    openByStatus,
    openCount: data.openTickets.length,
    overdue,
    notPickedUp,
    techs,
    topRepairs,
    owed,
    owedCount: data.receivable.filter((i) => n(i.total) - n(i.paid) > 0.004).length,
  };
}
export type Dashboard = ReturnType<typeof buildDashboard>;
