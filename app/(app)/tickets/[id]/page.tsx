import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/session";
import { STATUSES, fullName, deviceName, ticketLabel, dateTime, dateOnly, money, phonePretty, statusInfo } from "@/lib/format";
import { ui } from "@/lib/ui";
import StatusBadge from "@/components/StatusBadge";
import { setStatus, addNote, textCustomer, updateTicket } from "../actions";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string; edit?: string }> }) {
  const { id } = await params;
  const { new: isNew, edit } = await searchParams;
  const { supabase, shop } = await requireStaff();

  const { data: t } = await supabase
    .from("tickets")
    .select("*, customers(id, first_name, last_name, company, phone, email), technician:staff!tickets_technician_id_fkey(full_name)")
    .eq("id", id)
    .single();
  if (!t) notFound();

  const [{ data: events }, { data: invoices }, { data: techs }] = await Promise.all([
    supabase.from("ticket_events").select("*, staff(full_name)").eq("ticket_id", id).order("created_at", { ascending: false }),
    supabase.from("invoices").select("id, number, total, paid, status").eq("ticket_id", id).order("created_at"),
    supabase.from("staff").select("id, full_name").eq("active", true).order("full_name"),
  ]);

  const c: any = t.customers;
  const label = ticketLabel(shop.ticket_prefix, t.number);

  return (
    <div className="space-y-5">
      {isNew && (
        <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          Ticket {label} created.
          <Link href={`/print/label/${t.id}`} target="_blank" className={ui.btn}>
            Print label
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-brand-dark">{label}</p>
          <h1 className={ui.h1}>{deviceName(t)}</h1>
          <p className={ui.muted}>
            {t.device_type} · checked in {dateTime(t.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/print/label/${t.id}`} target="_blank" className={ui.btnGhost}>
            Print label
          </Link>
          <Link href={`/invoices/new?ticket=${t.id}`} className={ui.btn}>
            Create invoice
          </Link>
        </div>
      </div>

      {/* Status buttons */}
      <section className={ui.card}>
        <div className="mb-3 flex items-center gap-2">
          <h2 className={ui.h2}>Status</h2>
          <StatusBadge status={t.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <form key={s.key} action={setStatus}>
              <input type="hidden" name="ticket_id" value={t.id} />
              <input type="hidden" name="status" value={s.key} />
              <button
                disabled={t.status === s.key}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                  t.status === s.key ? "border-brand bg-brand text-white" : "border-zinc-300 bg-white text-zinc-700 hover:border-brand"
                }`}
              >
                {s.label}
              </button>
            </form>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-500">Moving to "Ready for pickup" texts the customer automatically.</p>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* Repair details */}
          <section className={ui.card}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className={ui.h2}>Repair</h2>
              <Link href={edit ? `/tickets/${t.id}` : `/tickets/${t.id}?edit=1`} className="text-sm text-zinc-500 hover:underline">
                {edit ? "Close" : "Edit"}
              </Link>
            </div>
            {edit ? (
              <form action={updateTicket} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="ticket_id" value={t.id} />
                <Edit label="Brand" name="brand" v={t.brand} />
                <Edit label="Model" name="model" v={t.model} />
                <Edit label="IMEI / serial" name="imei_serial" v={t.imei_serial} />
                <Edit label="Problem" name="problem" v={t.problem} />
                <Edit label="Estimate ($)" name="estimate" v={t.estimate} />
                <Edit label="Deposit ($)" name="deposit" v={t.deposit} />
                <div>
                  <label className={ui.label}>Technician</label>
                  <select name="technician_id" defaultValue={t.technician_id ?? ""} className={ui.input}>
                    <option value="">Not assigned</option>
                    {(techs ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <button className={ui.btn}>Save</button>
                </div>
              </form>
            ) : (
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Row k="Problem" v={t.problem} />
                <Row k="IMEI / serial" v={t.imei_serial} />
                <Row k="Colour" v={t.color} />
                <Row k="Left with us" v={t.accessories} />
                <Row k="Condition on arrival" v={t.condition_notes} />
                <Row k="Technician" v={(t as any).technician?.full_name ?? "Not assigned"} />
                <Row k="Estimate" v={t.estimate != null ? `${money(t.estimate)} + tax` : null} />
                <Row k="Deposit paid" v={money(t.deposit)} />
                {t.warranty_until && <Row k="Warranty until" v={dateOnly(t.warranty_until)} />}
              </dl>
            )}
          </section>

          {/* Notes + timeline */}
          <section className={ui.card}>
            <h2 className={`${ui.h2} mb-3`}>Notes and history</h2>
            <form action={addNote} className="mb-4 flex gap-2">
              <input type="hidden" name="ticket_id" value={t.id} />
              <input name="body" placeholder="Add a note (only staff see this)" className={ui.input} />
              <button className={ui.btnGhost}>Add</button>
            </form>
            <ol className="space-y-3">
              {(events ?? []).map((e: any) => (
                <li key={e.id} className="border-l-2 border-zinc-200 pl-3 text-sm">
                  <p className="text-zinc-900">
                    {e.kind === "status_change"
                      ? e.from_status
                        ? `${statusInfo(e.from_status).label} → ${statusInfo(e.to_status).label}`
                        : e.body
                      : e.body}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {e.staff?.full_name ?? "System"} · {dateTime(e.created_at)}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="space-y-5">
          {/* Customer */}
          <section className={ui.card}>
            <h2 className={`${ui.h2} mb-2`}>Customer</h2>
            <Link href={`/customers/${c?.id}`} className={`${ui.link} text-base`}>
              {fullName(c)}
            </Link>
            <p className="text-sm text-zinc-600">{phonePretty(c?.phone)}</p>
            <p className="text-sm text-zinc-600">{c?.email}</p>
            {c?.phone && (
              <form action={textCustomer} className="mt-3 space-y-2">
                <input type="hidden" name="ticket_id" value={t.id} />
                <textarea name="body" rows={3} className={ui.input} placeholder={`Text ${c.first_name ?? "customer"}…`} />
                <button className={`${ui.btnGhost} w-full`}>Send text</button>
              </form>
            )}
          </section>

          {/* Invoices */}
          <section className={ui.card}>
            <h2 className={`${ui.h2} mb-2`}>Invoices</h2>
            {(invoices ?? []).length ? (
              <ul className="space-y-1 text-sm">
                {invoices!.map((i) => (
                  <li key={i.id} className="flex justify-between">
                    <Link href={`/invoices/${i.id}`} className={ui.link}>
                      #{i.number}
                    </Link>
                    <span>
                      {money(i.total)} · {i.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={ui.muted}>No invoice yet.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{k}</dt>
      <dd className="text-zinc-900">{v || "—"}</dd>
    </div>
  );
}

function Edit({ label, name, v }: { label: string; name: string; v: any }) {
  return (
    <div>
      <label className={ui.label}>{label}</label>
      <input name={name} defaultValue={v ?? ""} className={ui.input} />
    </div>
  );
}
