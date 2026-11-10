import Link from "next/link";
import { requireStaff } from "@/lib/session";
import { ACTIVE_STATUSES, STATUSES, fullName, deviceName, ticketLabel, dateOnly, phonePretty } from "@/lib/format";
import { ui } from "@/lib/ui";
import StatusSelect from "@/components/StatusSelect";
import StatusBadge from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ status?: string; view?: string }> }) {
  const { status, view } = await searchParams;
  const { supabase, shop } = await requireStaff();

  const closed = status === "picked_up" || status === "cancelled";
  let q = supabase
    .from("tickets")
    .select("id, number, status, brand, model, device_type, problem, created_at, updated_at, customers(first_name, last_name, company, phone)")
    .order("number", { ascending: false })
    .limit(closed ? 100 : 500);
  if (status) q = q.eq("status", status);
  else q = q.not("status", "in", "(picked_up,cancelled)");
  const { data: tickets } = await q;
  const list = tickets ?? [];

  const asList = view === "list" || !!status;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={ui.h1}>Tickets</h1>
        <div className="flex gap-2">
          <Link href={asList ? "/tickets" : "/tickets?view=list"} className={ui.btnGhost}>
            {asList ? "Board view" : "List view"}
          </Link>
          <Link href="/tickets/new" className={ui.btn}>
            + New ticket
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Filter href="/tickets" label="All open" active={!status} />
        {STATUSES.map((s) => (
          <Filter key={s.key} href={`/tickets?status=${s.key}`} label={s.label} active={status === s.key} />
        ))}
      </div>

      {asList ? (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">Ticket</th>
                <th className="px-4 py-3">Device</th>
                <th className="px-4 py-3">Problem</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Checked in</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {list.map((t: any) => (
                <tr key={t.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link href={`/tickets/${t.id}`} className={ui.link}>
                      {ticketLabel(shop.ticket_prefix, t.number)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{deviceName(t)}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-zinc-600">{t.problem}</td>
                  <td className="px-4 py-3">
                    {fullName(t.customers)}
                    <div className="text-xs text-zinc-500">{phonePretty(t.customers?.phone)}</div>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{dateOnly(t.created_at)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={t.status} />
                  </td>
                </tr>
              ))}
              {!list.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-zinc-500">
                    No tickets here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {ACTIVE_STATUSES.map((s) => {
            const col = list.filter((t: any) => t.status === s.key);
            return (
              <section key={s.key} className="w-72 shrink-0 rounded-xl bg-zinc-100/70 p-3">
                <h2 className="mb-3 flex items-center justify-between text-sm font-semibold text-zinc-700">
                  {s.label}
                  <span className="rounded-full bg-white px-2 text-xs text-zinc-500">{col.length}</span>
                </h2>
                <div className="space-y-2">
                  {col.map((t: any) => (
                    <div key={t.id} className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
                      <Link href={`/tickets/${t.id}`} className="block">
                        <p className="text-xs font-semibold text-brand-dark">{ticketLabel(shop.ticket_prefix, t.number)}</p>
                        <p className="text-sm font-semibold text-zinc-900">{deviceName(t)}</p>
                        <p className="truncate text-xs text-zinc-600">{t.problem}</p>
                        <p className="mt-1 truncate text-xs text-zinc-500">{fullName(t.customers)}</p>
                      </Link>
                      <div className="mt-2">
                        <StatusSelect ticketId={t.id} status={t.status} />
                      </div>
                    </div>
                  ))}
                  {!col.length && <p className="px-1 text-xs text-zinc-400">Empty</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Filter({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-brand text-white" : "bg-white text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50"}`}
    >
      {label}
    </Link>
  );
}
