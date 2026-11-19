import Link from "next/link";
import { requireStaff, canManage } from "@/lib/session";
import { fullName, deviceName, ticketLabel, dateTime } from "@/lib/format";
import { cents } from "@/lib/money";
import { ui } from "@/lib/ui";
import StatusBadge from "@/components/StatusBadge";
import SalesChart from "@/components/SalesChart";
import { Icon } from "@/components/NavLinks";
import { PERIODS, periodRange, rangeDates, ticketStats, change, type PeriodKey, type TicketRow } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

type Money = {
  sales_cents: number;
  costs_cents: number;
  net_profit_cents: number;
  hst_owing_cents: number;
  money_in: Record<string, number>;
  invoices: { open_count: number; open_cents: number; overdue_count: number; overdue_cents: number; paid_count: number; paid_cents: number };
  series: { date: string; sales_cents: number; costs_cents: number }[];
  series_by: "day" | "month";
};

export default async function Home({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const sp = await searchParams;
  const { supabase, staff, shop } = await requireStaff();
  const period: PeriodKey = sp.p && sp.p in PERIODS ? (sp.p as PeriodKey) : "today";
  const range = periodRange(period);
  const dates = rangeDates(range);
  const showMoney = canManage(staff);
  const counter = staff.role !== "technician";
  const since = new Date(Math.min(range.prevStart, range.buckets[0].start)).toISOString();

  // The chart for "Today" shows the last 7 days for context.
  const chartFrom = period === "today" ? rangeDates({ ...range, start: range.buckets[0].start }).from : dates.from;

  const [{ data: open }, { data: recent }, drawer, moneyNow, moneyBefore, chart] = await Promise.all([
    supabase
      .from("tickets")
      .select("id, number, status, created_at, picked_up_at, device_type, brand, model, problem, updated_at, customers(first_name, last_name, company)")
      .not("status", "in", "(picked_up,cancelled)")
      .order("updated_at", { ascending: true }),
    supabase.from("tickets").select("id, status, created_at, picked_up_at, device_type, problem").or(`created_at.gte.${since},picked_up_at.gte.${since}`),
    counter ? supabase.rpc("drawer_status") : Promise.resolve({ data: null }),
    showMoney ? supabase.rpc("dashboard_money", { p_from: dates.from, p_to: dates.to }) : Promise.resolve({ data: null }),
    showMoney ? supabase.rpc("dashboard_money", { p_from: dates.prevFrom, p_to: dates.prevTo }) : Promise.resolve({ data: null }),
    showMoney && chartFrom !== dates.from ? supabase.rpc("dashboard_money", { p_from: chartFrom, p_to: dates.to }) : Promise.resolve({ data: null }),
  ]);

  const openTickets = (open ?? []) as any[];
  const stats = ticketStats(range, (recent ?? []) as TicketRow[], openTickets as TicketRow[]);
  const startOfToday = periodRange("today").start;
  const ready = openTickets.filter((t) => t.status === "ready");
  const waiting = openTickets.filter((t) => t.status === "awaiting_approval" || t.status === "awaiting_parts");
  const today = openTickets.filter((t) => Date.parse(t.created_at) >= startOfToday).reverse();
  const m = moneyNow.data as Money | null;
  const before = moneyBefore.data as Money | null;
  const series = ((chart.data as Money | null) ?? m)?.series ?? [];
  const d = drawer.data as { open: boolean; opened_by?: string } | null;
  const hour = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-6">
      {/* 1. Greeting + quick actions */}
      <div>
        <h1 className={ui.h1}>
          {hello}, {staff.full_name.split(" ")[0]}
        </h1>
        <p className={ui.muted}>{new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", dateStyle: "full" }).format(new Date())}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Action href="/tickets/new" title="New repair ticket" hint="Check in a device" icon="M12 5v14M5 12h14" primary />
        {counter && <Action href="/invoices/new" title="New sale" hint="Accessories, devices" icon="M6 2h9l5 5v15H6zM14 2v6h6" />}
        {showMoney ? (
          <Action href="/expenses?add=1" title="Add expense" hint="Rent, parts, supplies" icon="M4 4h16v16H4zM8 9h8M8 13h8" />
        ) : (
          <Action href="/customers/new" title="New customer" hint="Add to the list" icon="M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7z" />
        )}
        {counter ? (
          <Action
            href="/cash"
            title={d?.open ? "Cash drawer open" : "Open cash drawer"}
            hint={d?.open ? `Opened by ${d.opened_by ?? "staff"}` : "Count the float to start the day"}
            icon="M3 7h18v12H3zM3 11h18"
            warn={!d?.open}
          />
        ) : (
          <Action href="/customers" title="Find customer" hint="Phone, name, ticket #" icon="M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3" />
        )}
      </div>

      {/* 2. Today at the counter */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Today at the counter</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Count n={ready.length} label="Ready for pickup" href="/tickets?status=ready" tone="green" />
          <Count n={waiting.length} label="Waiting on customer or parts" href="/tickets?status=awaiting_approval" tone="amber" />
          <Count n={stats.overdue.length} label="In the shop over 7 days" href="/tickets?view=list" tone="red" />
          <Count n={today.length} label="Checked in today" href="/tickets" tone="zinc" />
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          <Panel title="Ready, waiting for pickup" empty="Nothing waiting for pickup.">
            {ready.map((t) => (
              <TicketRow key={t.id} t={t} prefix={shop.ticket_prefix} />
            ))}
          </Panel>
          <Panel title="Waiting on customer or parts" empty="Nothing waiting.">
            {waiting.map((t) => (
              <TicketRow key={t.id} t={t} prefix={shop.ticket_prefix} />
            ))}
          </Panel>
          <Panel title="Checked in today" empty="No new tickets yet today.">
            {today.map((t) => (
              <TicketRow key={t.id} t={t} prefix={shop.ticket_prefix} />
            ))}
          </Panel>
        </div>
      </section>

      {/* 3. Money (owner/manager) */}
      {showMoney && m && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Money · {PERIODS[period]}</h2>
            <nav className="flex rounded-lg border border-zinc-200 bg-surface p-1 text-sm">
              {(Object.keys(PERIODS) as PeriodKey[]).map((k) => (
                <Link key={k} href={`/?p=${k}`} className={`rounded-md px-3 py-1.5 font-medium ${k === period ? "bg-brand text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>
                  {PERIODS[k]}
                </Link>
              ))}
            </nav>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Sales" value={cents(m.sales_cents)} delta={change(m.sales_cents, before?.sales_cents ?? 0)} sub={`before ${shop.tax_name ?? "HST"} · ${range.compareLabel}`} href={`/reports?r=pnl&from=${dates.from}&to=${dates.to}`} />
            <Kpi label="Costs & expenses" value={cents(m.costs_cents)} sub="parts, rent, wages…" href={`/reports?r=expenses&from=${dates.from}&to=${dates.to}`} />
            <Kpi label="Net profit" value={cents(m.net_profit_cents)} delta={change(m.net_profit_cents, before?.net_profit_cents ?? 0)} sub="sales − all costs" strong={m.net_profit_cents >= 0 ? "good" : "bad"} href={`/reports?r=pnl&from=${dates.from}&to=${dates.to}`} />
            <Kpi label="Cash in" value={cents(m.money_in.cash ?? 0)} sub="check it against the drawer" href="/cash" />
            <Kpi label="Card & e-Transfer in" value={cents((m.money_in.debit ?? 0) + (m.money_in.credit ?? 0) + (m.money_in.etransfer ?? 0))} sub={`debit ${cents(m.money_in.debit ?? 0)} · credit ${cents(m.money_in.credit ?? 0)}`} href={`/reports?r=payments&from=${dates.from}&to=${dates.to}`} />
            <Kpi label={`${shop.tax_name ?? "HST"} owing`} value={cents(m.hst_owing_cents)} sub="collected − claimed back" href={`/reports?r=hst&from=${dates.from}&to=${dates.to}`} />
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <section className={`${ui.card} xl:col-span-2`}>
              <h3 className={`${ui.h2} mb-1`}>Sales vs costs</h3>
              <SalesChart data={series} by={period === "year" ? "month" : "day"} />
            </section>
            <div className="space-y-5">
              <section className={ui.card}>
                <div className="mb-3 flex items-baseline justify-between">
                  <h3 className={ui.h2}>Invoices</h3>
                  <Link href="/invoices" className="text-xs text-zinc-500 hover:underline">
                    All sales →
                  </Link>
                </div>
                <InvoiceBar inv={m.invoices} />
              </section>
              <section className={ui.card}>
                <div className="mb-3 flex items-baseline justify-between">
                  <h3 className={ui.h2}>Profit &amp; loss</h3>
                  <Link href={`/reports?r=pnl&from=${dates.from}&to=${dates.to}`} className="text-xs text-zinc-500 hover:underline">
                    Full report →
                  </Link>
                </div>
                <dl className="space-y-1.5 text-sm">
                  <PL k="Sales" v={m.sales_cents} />
                  <PL k="Costs & expenses" v={-m.costs_cents} />
                  <PL k="Net profit" v={m.net_profit_cents} strong />
                </dl>
              </section>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function Action({ href, title, hint, icon, primary, warn }: { href: string; title: string; hint: string; icon: string; primary?: boolean; warn?: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow ${
        primary ? "border-brand bg-brand text-white" : warn ? "border-amber-300 bg-amber-100" : "border-zinc-200 bg-surface"
      }`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${primary ? "bg-white/20" : "bg-brand-soft text-brand-dark"}`}>
        <Icon d={icon} className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className={`block truncate font-semibold ${primary ? "" : "text-zinc-900"}`}>{title}</span>
        <span className={`block truncate text-xs ${primary ? "text-white/85" : warn ? "text-amber-800" : "text-zinc-500"}`}>{hint}</span>
      </span>
    </Link>
  );
}

const TONE: Record<string, string> = {
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-700",
  zinc: "bg-zinc-100 text-zinc-700",
};

function Count({ n, label, href, tone }: { n: number; label: string; href: string; tone: string }) {
  return (
    <Link href={href} className={`${ui.card} flex items-center gap-3 hover:border-brand`}>
      <span className={`flex h-11 min-w-11 items-center justify-center rounded-full px-2 text-xl font-bold ${n ? TONE[tone] : "bg-zinc-100 text-zinc-400"}`}>{n}</span>
      <span className="text-sm font-medium text-zinc-700">{label}</span>
    </Link>
  );
}

function Kpi({ label, value, sub, delta, href, strong }: { label: string; value: string; sub?: string; delta?: number | null; href?: string; strong?: "good" | "bad" }) {
  const body = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tracking-tight ${strong === "bad" ? "text-red-700" : "text-zinc-900"}`}>{value}</p>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
        {delta !== undefined && delta !== null && (
          <span className={`font-semibold ${delta >= 0 ? "text-green-800" : "text-red-700"}`}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%
          </span>
        )}
        {sub}
      </p>
    </>
  );
  return href ? (
    <Link href={href} className={`${ui.card} block hover:border-brand`}>
      {body}
    </Link>
  ) : (
    <div className={ui.card}>{body}</div>
  );
}

function InvoiceBar({ inv }: { inv: Money["invoices"] }) {
  const notDue = inv.open_cents - inv.overdue_cents;
  const total = inv.overdue_cents + notDue + inv.paid_cents || 1;
  const rows = [
    { label: `Overdue (${inv.overdue_count})`, v: inv.overdue_cents, color: "bg-red-500", href: "/invoices?status=overdue" },
    { label: `Unpaid, not due (${inv.open_count - inv.overdue_count})`, v: notDue, color: "bg-amber-400", href: "/invoices?status=open" },
    { label: `Paid this period (${inv.paid_count})`, v: inv.paid_cents, color: "bg-green-500", href: "/invoices?status=paid" },
  ];
  return (
    <div className="space-y-3">
      <div className="flex h-3 overflow-hidden rounded-full bg-zinc-100" aria-hidden>
        {rows.map((r) => (
          <div key={r.label} className={r.color} style={{ width: `${(r.v / total) * 100}%` }} />
        ))}
      </div>
      <ul className="space-y-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.label}>
            <Link href={r.href} className="flex items-center justify-between gap-2 hover:underline">
              <span className="flex items-center gap-2 text-zinc-700">
                <span className={`h-2.5 w-2.5 rounded-full ${r.color}`} />
                {r.label}
              </span>
              <span className="font-medium text-zinc-900">{cents(r.v)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PL({ k, v, strong }: { k: string; v: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "border-t border-zinc-200 pt-1.5 font-semibold text-zinc-900" : "text-zinc-600"}`}>
      <dt>{k}</dt>
      <dd className={strong && v < 0 ? "text-red-700" : ""}>{v < 0 ? `− ${cents(-v)}` : cents(v)}</dd>
    </div>
  );
}

function Panel({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section className={ui.card}>
      <h3 className={`${ui.h2} mb-3`}>{title}</h3>
      {children.length ? <ul className="divide-y divide-zinc-100">{children}</ul> : <p className={ui.muted}>{empty}</p>}
    </section>
  );
}

function TicketRow({ t, prefix }: { t: any; prefix: string }) {
  return (
    <li>
      <Link href={`/tickets/${t.id}`} className="flex items-center justify-between gap-3 py-2 hover:bg-zinc-50">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-900">
            <span className="text-brand-dark">{ticketLabel(prefix, t.number)}</span> · {deviceName(t)}
          </p>
          <p className="truncate text-xs text-zinc-500">
            {fullName(t.customers)} · {dateTime(t.updated_at ?? t.created_at)}
          </p>
        </div>
        <StatusBadge status={t.status} />
      </Link>
    </li>
  );
}
