import Link from "next/link";
import { requireStaff } from "@/lib/session";
import { ACTIVE_STATUSES, money, fullName, deviceName, ticketLabel, dateTime } from "@/lib/format";
import { ui } from "@/lib/ui";
import StatusBadge from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

function startOfTodayToronto() {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: "America/Toronto" }));
  const offset = now.getTime() - local.getTime();
  local.setHours(0, 0, 0, 0);
  return new Date(local.getTime() + offset).toISOString();
}

export default async function Home() {
  const { supabase, staff, shop } = await requireStaff();
  const today = startOfTodayToronto();

  const [{ data: open }, { data: todaysInvoices }, { data: recent }] = await Promise.all([
    supabase
      .from("tickets")
      .select("id, number, status, brand, model, device_type, updated_at, customers(first_name, last_name, company)")
      .not("status", "in", "(picked_up,cancelled)")
      .order("updated_at", { ascending: true }),
    supabase.from("invoices").select("total, paid, status").gte("created_at", today).neq("status", "void"),
    supabase
      .from("tickets")
      .select("id, number, status, brand, model, device_type, created_at, customers(first_name, last_name, company)")
      .gte("created_at", today)
      .order("created_at", { ascending: false }),
  ]);

  const counts = Object.fromEntries(ACTIVE_STATUSES.map((s) => [s.key, 0]));
  (open ?? []).forEach((t) => (counts[t.status] = (counts[t.status] ?? 0) + 1));
  const sales = (todaysInvoices ?? []).reduce((a, i) => a + Number(i.total), 0);
  const collected = (todaysInvoices ?? []).reduce((a, i) => a + Number(i.paid), 0);
  const ready = (open ?? []).filter((t) => t.status === "ready");
  const waiting = (open ?? []).filter((t) => t.status === "awaiting_approval" || t.status === "awaiting_parts");

  return (
    <div className="space-y-6">
      <div>
        <h1 className={ui.h1}>Good to see you, {staff.full_name.split(" ")[0]}</h1>
        <p className={ui.muted}>Here's {shop.name} today.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open tickets" value={String(open?.length ?? 0)} href="/tickets" />
        <Stat label="Ready for pickup" value={String(counts.ready ?? 0)} href="/tickets?status=ready" accent />
        <Stat label="Sales today" value={money(sales)} href="/invoices" />
        <Stat label="Collected today" value={money(collected)} href="/invoices" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Ready, waiting for pickup" empty="Nothing waiting for pickup.">
          {ready.map((t: any) => (
            <TicketRow key={t.id} t={t} prefix={shop.ticket_prefix} />
          ))}
        </Panel>
        <Panel title="Waiting on customer or parts" empty="Nothing waiting.">
          {waiting.map((t: any) => (
            <TicketRow key={t.id} t={t} prefix={shop.ticket_prefix} />
          ))}
        </Panel>
        <Panel title="Checked in today" empty="No new tickets yet today.">
          {(recent ?? []).map((t: any) => (
            <TicketRow key={t.id} t={t} prefix={shop.ticket_prefix} />
          ))}
        </Panel>
      </div>
    </div>
  );
}

function Stat({ label, value, href, accent }: { label: string; value: string; href: string; accent?: boolean }) {
  return (
    <Link href={href} className={`${ui.card} block hover:border-brand ${accent ? "border-brand bg-brand-soft" : ""}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-zinc-900">{value}</p>
    </Link>
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
