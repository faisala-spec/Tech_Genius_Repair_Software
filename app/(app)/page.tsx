import Link from "next/link";
import { requireStaff, canManage } from "@/lib/session";
import { ACTIVE_STATUSES, PAYMENT_METHODS, money, fullName, deviceName, ticketLabel, dateTime, statusInfo } from "@/lib/format";
import { ui } from "@/lib/ui";
import StatusBadge from "@/components/StatusBadge";
import RevenueChart from "@/components/RevenueChart";
import { PERIODS, periodRange, buildDashboard, type PeriodKey, type InvoiceRow, type PaymentRow, type TicketRow } from "@/lib/dashboard";
import { demoData } from "@/lib/dashboardDemo";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ p?: string; demo?: string }> }) {
  const sp = await searchParams;
  const { supabase, staff, shop } = await requireStaff();
  const period: PeriodKey = sp.p && sp.p in PERIODS ? (sp.p as PeriodKey) : "today";
  const range = periodRange(period);
  const showMoney = canManage(staff);
  const since = new Date(Math.min(range.prevStart, range.buckets[0].start)).toISOString();
  // Sample numbers for designing the screen, on a developer's computer only.
  const demo = process.env.NODE_ENV === "development" && sp.demo === "1";

  const [inv, pay, tks, open, owed] = demo
    ? demoData(range)
    : await Promise.all([
        showMoney
          ? supabase
              .from("invoices")
              .select("created_at, status, subtotal, discount, tax, total, paid, invoice_items(qty, unit_cost), tickets(technician_id)")
              .gte("created_at", since)
              .neq("status", "void")
          : Promise.resolve({ data: [] }),
        showMoney ? supabase.from("payments").select("created_at, method, amount").gte("created_at", range.start ? new Date(range.start).toISOString() : since) : Promise.resolve({ data: [] }),
        supabase
          .from("tickets")
          .select("id, status, created_at, picked_up_at, technician_id, device_type, problem")
          .or(`created_at.gte.${since},picked_up_at.gte.${since}`),
        supabase
          .from("tickets")
          .select("id, number, status, created_at, picked_up_at, technician_id, device_type, brand, model, problem, updated_at, customers(first_name, last_name, company)")
          .not("status", "in", "(picked_up,cancelled)")
          .order("updated_at", { ascending: true }),
        showMoney ? supabase.from("invoices").select("total, paid").in("status", ["unpaid", "partial"]) : Promise.resolve({ data: [] }),
      ]).then((r) => r.map((x: any) => x.data ?? []));

  const { data: staffList } = await supabase.from("staff").select("id, full_name").eq("active", true);
  const techName = (id: string) =>
    id === "none" ? "Not assigned" : id.startsWith("demo-tech-") ? `Sample tech ${id.slice(-1)}` : staffList?.find((s) => s.id === id)?.full_name ?? "Former staff";

  const d = buildDashboard(range, {
    invoices: inv as InvoiceRow[],
    payments: pay as PaymentRow[],
    tickets: tks as TicketRow[],
    openTickets: open as TicketRow[],
    receivable: owed as any[],
  });
  const openTickets = open as any[];
  const ready = openTickets.filter((t) => t.status === "ready");
  const waiting = openTickets.filter((t) => t.status === "awaiting_approval" || t.status === "awaiting_parts");
  const startOfToday = periodRange("today").start;
  const checkedInToday = openTickets.filter((t) => Date.parse(t.created_at) >= startOfToday).reverse();

  const periodLink = (k: PeriodKey) => `/?p=${k}${demo ? "&demo=1" : ""}`;

  return (
    <div className="space-y-6">
      {/* Header + period */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className={ui.h1}>Good to see you, {staff.full_name.split(" ")[0]}</h1>
          <p className={ui.muted}>
            {shop.name} · {PERIODS[period]}
            {demo && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">SAMPLE NUMBERS</span>}
          </p>
        </div>
        <nav className="flex rounded-lg border border-zinc-200 bg-white p-1 text-sm">
          {(Object.keys(PERIODS) as PeriodKey[]).map((k) => (
            <Link key={k} href={periodLink(k)} className={`rounded-md px-3 py-1.5 font-medium ${k === period ? "bg-brand text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>
              {PERIODS[k]}
            </Link>
          ))}
        </nav>
      </div>

      {/* Headline numbers */}
      {showMoney ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Revenue" value={money(d.revenue)} delta={d.revenueChange} sub={`before ${shop.tax_name ?? "HST"} · ${range.compareLabel}`} href="/invoices" />
          <Kpi label="Gross profit" value={money(d.profit)} delta={d.profitChange} sub={d.margin === null ? "revenue − part costs" : `${d.margin}% margin`} />
          <Kpi label="Money collected" value={money(d.collected)} sub="all payment methods" />
          <Kpi label={`${shop.tax_name ?? "HST"} collected`} value={money(d.tax)} sub="owed to CRA" />
          <Kpi label="Repairs completed" value={String(d.completed)} sub={d.turnaround === null ? "picked up" : `avg ${d.turnaround} days in shop`} href="/tickets?status=picked_up" />
          <Kpi label="Average sale" value={money(d.avgSale)} sub={`${d.invoiceCount} invoice${d.invoiceCount === 1 ? "" : "s"}`} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Open tickets" value={String(d.openCount)} href="/tickets" />
          <Kpi label="Ready for pickup" value={String(ready.length)} href="/tickets?status=ready" />
          <Kpi label="Checked in" value={String(d.created)} delta={d.createdChange} sub={range.compareLabel} />
          <Kpi label="Repairs completed" value={String(d.completed)} sub={d.turnaround === null ? "picked up" : `avg ${d.turnaround} days in shop`} />
        </div>
      )}

      {showMoney && (
        <div className="grid gap-5 xl:grid-cols-3">
          {/* Revenue chart */}
          <section className={`${ui.card} xl:col-span-2`}>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className={ui.h2}>Revenue {period === "year" ? "by month" : "by day"}</h2>
              <span className="text-xs text-zinc-500">before tax · hover a bar for profit</span>
            </div>
            <RevenueChart data={d.series} />
          </section>

          {/* Profit & loss */}
          <section className={ui.card}>
            <h2 className={`${ui.h2} mb-3`}>Profit &amp; loss · {PERIODS[period].toLowerCase()}</h2>
            <dl className="space-y-2 text-sm">
              <PL k="Sales (before tax)" v={d.revenue} />
              <PL k="Cost of parts" v={-d.cogs} muted />
              <PL k="Gross profit" v={d.profit} strong />
              <PL k="Expenses (rent, payroll, supplies)" v={null} muted />
              <PL k="Net profit" v={null} strong />
            </dl>
            <p className="mt-3 rounded-lg bg-zinc-50 p-2.5 text-xs text-zinc-500">
              Part costs come from the “Part cost” box on each invoice line. Expense tracking is next on the list; then net profit fills in here.
            </p>
          </section>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Payments */}
        {showMoney && (
          <section className={ui.card}>
            <h2 className={`${ui.h2} mb-3`}>Payments taken</h2>
            {d.collected || d.refunds ? (
              <ul className="space-y-2.5 text-sm">
                {PAYMENT_METHODS.filter((m) => d.byMethod[m.key]).map((m) => (
                  <BarRow key={m.key} label={m.label} value={d.byMethod[m.key]} max={Math.max(...Object.values(d.byMethod))} text={money(d.byMethod[m.key])} />
                ))}
                {d.refunds > 0 && <li className="text-xs text-zinc-500">Includes {money(d.refunds)} refunded</li>}
              </ul>
            ) : (
              <p className={ui.muted}>No payments in this period.</p>
            )}
            {d.byMethod.cash ? <p className="mt-3 text-xs text-zinc-500">Cash in: {money(d.byMethod.cash)}. Check it against the drawer at close.</p> : null}
          </section>
        )}

        {/* Tickets by status */}
        <section className={ui.card}>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className={ui.h2}>Open tickets</h2>
            <Link href="/tickets" className="text-xs text-zinc-500 hover:underline">
              {d.openCount} open →
            </Link>
          </div>
          {d.openCount ? (
            <ul className="space-y-2.5 text-sm">
              {ACTIVE_STATUSES.map((s) => (
                <BarRow
                  key={s.key}
                  label={s.label}
                  value={d.openByStatus[s.key] ?? 0}
                  max={Math.max(...Object.values(d.openByStatus))}
                  text={String(d.openByStatus[s.key] ?? 0)}
                  href={`/tickets?status=${s.key}`}
                />
              ))}
            </ul>
          ) : (
            <p className={ui.muted}>No open tickets.</p>
          )}
        </section>

        {/* Needs attention */}
        <section className={ui.card}>
          <h2 className={`${ui.h2} mb-3`}>Needs attention</h2>
          <ul className="space-y-3 text-sm">
            <Attention
              n={d.overdue.length}
              label="in the shop over 7 days"
              href="/tickets?view=list"
              tone={d.overdue.length ? "warn" : "ok"}
            />
            <Attention n={ready.length} label="ready, not picked up yet" href="/tickets?status=ready" tone={ready.length ? "info" : "ok"} />
            <Attention
              n={openTickets.filter((t) => t.status === "awaiting_approval").length}
              label="waiting for customer approval"
              href="/tickets?status=awaiting_approval"
              tone="info"
            />
            {showMoney && (
              <li className="flex items-center justify-between gap-3">
                <Link href="/invoices?status=unpaid" className="text-zinc-700 hover:underline">
                  Unpaid invoices ({d.owedCount})
                </Link>
                <span className={`font-semibold ${d.owed ? "text-amber-700" : "text-zinc-400"}`}>{money(d.owed)}</span>
              </li>
            )}
          </ul>
        </section>
      </div>

      {/* Technicians + top repairs */}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className={ui.card}>
          <h2 className={`${ui.h2} mb-3`}>Technicians · {PERIODS[period].toLowerCase()}</h2>
          {Object.keys(d.techs).length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="pb-2">Technician</th>
                  <th className="pb-2 text-right">Repairs done</th>
                  {showMoney && <th className="pb-2 text-right">Revenue</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {Object.entries(d.techs)
                  .sort((a, b) => b[1].revenue - a[1].revenue || b[1].completed - a[1].completed)
                  .map(([id, t]) => (
                    <tr key={id}>
                      <td className="py-2">{techName(id)}</td>
                      <td className="py-2 text-right">{t.completed}</td>
                      {showMoney && <td className="py-2 text-right">{money(t.revenue)}</td>}
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <p className={ui.muted}>No finished repairs in this period. Assign a technician on each ticket to see who did what.</p>
          )}
        </section>

        <section className={ui.card}>
          <h2 className={`${ui.h2} mb-3`}>Most common repairs · {PERIODS[period].toLowerCase()}</h2>
          {d.topRepairs.length ? (
            <ul className="space-y-2.5 text-sm">
              {d.topRepairs.map(([k, v]) => (
                <BarRow key={k} label={k} value={v} max={d.topRepairs[0][1]} text={String(v)} />
              ))}
            </ul>
          ) : (
            <p className={ui.muted}>No tickets checked in during this period.</p>
          )}
        </section>
      </div>

      {/* Work queues */}
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
          {checkedInToday.map((t) => (
            <TicketRow key={t.id} t={t} prefix={shop.ticket_prefix} />
          ))}
        </Panel>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, delta, href }: { label: string; value: string; sub?: string; delta?: number | null; href?: string }) {
  const body = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">{value}</p>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
        {delta !== undefined && delta !== null && (
          <span className={`font-semibold ${delta >= 0 ? "text-green-700" : "text-red-700"}`}>
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

function PL({ k, v, strong, muted }: { k: string; v: number | null; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "border-t border-zinc-200 pt-2 font-semibold text-zinc-900" : ""} ${muted ? "text-zinc-500" : ""}`}>
      <dt>{k}</dt>
      <dd>{v === null ? <span className="text-xs font-normal text-zinc-400">not tracked yet</span> : v < 0 ? `− ${money(-v)}` : money(v)}</dd>
    </div>
  );
}

function BarRow({ label, value, max, text, href }: { label: string; value: number; max: number; text: string; href?: string }) {
  const pct = max > 0 ? Math.max(value > 0 ? 3 : 0, (value / max) * 100) : 0;
  const inner = (
    <>
      <div className="mb-1 flex justify-between gap-2">
        <span className="truncate text-zinc-700">{label}</span>
        <span className="font-medium text-zinc-900">{text}</span>
      </div>
      <div className="h-2 rounded-full bg-zinc-100">
        <div className="h-2 rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
    </>
  );
  return <li>{href ? <Link href={href} className="block hover:opacity-80">{inner}</Link> : inner}</li>;
}

function Attention({ n, label, href, tone }: { n: number; label: string; href: string; tone: "warn" | "info" | "ok" }) {
  const color = !n ? "bg-zinc-100 text-zinc-400" : tone === "warn" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800";
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 text-zinc-700 hover:underline">
        <span className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-bold ${color}`}>{n}</span>
        {label}
      </Link>
    </li>
  );
}

function Panel({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section className={ui.card}>
      <h2 className={`${ui.h2} mb-3`}>{title}</h2>
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
