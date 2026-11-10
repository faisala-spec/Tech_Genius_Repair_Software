import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/session";
import { fullName, phonePretty, money, dateOnly, deviceName, ticketLabel } from "@/lib/format";
import { ui } from "@/lib/ui";
import StatusBadge from "@/components/StatusBadge";
import CustomerForm from "@/components/CustomerForm";
import { updateCustomer } from "../actions";

export const dynamic = "force-dynamic";

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { id } = await params;
  const { edit } = await searchParams;
  const { supabase, shop } = await requireStaff();

  const { data: c } = await supabase.from("customers").select("*").eq("id", id).single();
  if (!c) notFound();

  const [{ data: tickets }, { data: invoices }, { data: texts }] = await Promise.all([
    supabase.from("tickets").select("id, number, status, brand, model, device_type, problem, created_at").eq("customer_id", id).order("created_at", { ascending: false }),
    supabase.from("invoices").select("id, number, total, paid, status, created_at").eq("customer_id", id).order("created_at", { ascending: false }),
    supabase.from("messages").select("id, body, direction, status, created_at").eq("customer_id", id).order("created_at", { ascending: false }).limit(20),
  ]);

  if (edit) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <div className="flex items-center justify-between">
          <h1 className={ui.h1}>Edit {fullName(c)}</h1>
          <Link href={`/customers/${id}`} className="text-sm text-zinc-500 hover:underline">
            Cancel
          </Link>
        </div>
        <CustomerForm action={updateCustomer} c={c} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={ui.h1}>{fullName(c)}</h1>
          <p className={ui.muted}>
            {phonePretty(c.phone)}
            {c.email ? ` · ${c.email}` : ""}
            {c.company ? ` · ${c.company}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/customers/${id}?edit=1`} className={ui.btnGhost}>
            Edit
          </Link>
          <Link href={`/invoices/new?customer=${id}`} className={ui.btnGhost}>
            Sell / invoice
          </Link>
          <Link href={`/tickets/new?customer=${id}`} className={ui.btn}>
            + New ticket
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Mini k="Tickets here" v={String(tickets?.length ?? 0)} />
        <Mini k="Invoices here" v={String(invoices?.length ?? 0)} />
        <Mini k="RepairDesk tickets" v={String(c.legacy_ticket_count ?? 0)} />
        <Mini k="RepairDesk spend" v={money(c.legacy_lifetime_spend)} />
      </div>

      {c.notes && (
        <section className={`${ui.card} text-sm`}>
          <h2 className={`${ui.h2} mb-1`}>Notes</h2>
          <p className="whitespace-pre-wrap text-zinc-700">{c.notes}</p>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={ui.card}>
          <h2 className={`${ui.h2} mb-3`}>Tickets</h2>
          <ul className="divide-y divide-zinc-100">
            {(tickets ?? []).map((t) => (
              <li key={t.id}>
                <Link href={`/tickets/${t.id}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-zinc-50">
                  <span>
                    <span className="font-semibold text-brand-dark">{ticketLabel(shop.ticket_prefix, t.number)}</span> {deviceName(t)} ·{" "}
                    <span className="text-zinc-500">{dateOnly(t.created_at)}</span>
                  </span>
                  <StatusBadge status={t.status} />
                </Link>
              </li>
            ))}
            {!tickets?.length && <li className={ui.muted}>No tickets yet.</li>}
          </ul>
        </section>

        <section className={ui.card}>
          <h2 className={`${ui.h2} mb-3`}>Invoices</h2>
          <ul className="divide-y divide-zinc-100">
            {(invoices ?? []).map((i) => (
              <li key={i.id}>
                <Link href={`/invoices/${i.id}`} className="flex justify-between py-2 text-sm hover:bg-zinc-50">
                  <span>
                    <span className="font-semibold">#{i.number}</span> · <span className="text-zinc-500">{dateOnly(i.created_at)}</span>
                  </span>
                  <span>
                    {money(i.total)} · {i.status}
                  </span>
                </Link>
              </li>
            ))}
            {!invoices?.length && <li className={ui.muted}>No invoices yet.</li>}
          </ul>
        </section>
      </div>

      <section className={ui.card}>
        <h2 className={`${ui.h2} mb-3`}>Texts</h2>
        <ul className="space-y-2 text-sm">
          {(texts ?? []).map((m) => (
            <li key={m.id} className="rounded-lg bg-zinc-50 p-2">
              <p>{m.body}</p>
              <p className="text-xs text-zinc-500">
                {m.direction === "out" ? "Sent" : "Received"} · {m.status} · {dateOnly(m.created_at)}
              </p>
            </li>
          ))}
          {!texts?.length && <li className={ui.muted}>No texts yet.</li>}
        </ul>
      </section>
    </div>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div className={ui.card}>
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{k}</p>
      <p className="mt-1 text-xl font-bold">{v}</p>
    </div>
  );
}
