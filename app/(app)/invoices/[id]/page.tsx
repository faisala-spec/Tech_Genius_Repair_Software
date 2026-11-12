import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff, canManage } from "@/lib/session";
import { fullName, money, dateTime, phonePretty, ticketLabel, PAYMENT_METHODS } from "@/lib/format";
import { ui } from "@/lib/ui";
import { addPayment, voidInvoice } from "../actions";

export const dynamic = "force-dynamic";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, staff, shop } = await requireStaff();

  const { data: inv } = await supabase
    .from("invoices")
    .select("*, customers(id, first_name, last_name, company, phone, email), tickets(id, number)")
    .eq("id", id)
    .single();
  if (!inv) notFound();

  const [{ data: items }, { data: payments }] = await Promise.all([
    supabase.from("invoice_items").select("*").eq("invoice_id", id),
    supabase.from("payments").select("*").eq("invoice_id", id).order("created_at"),
  ]);

  const due = Number(inv.total) - Number(inv.paid);
  const c: any = inv.customers;
  const t: any = inv.tickets;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={ui.h1}>Invoice #{inv.number}</h1>
          <p className={ui.muted}>
            {dateTime(inv.created_at)} · {c ? <Link href={`/customers/${c.id}`} className={ui.link}>{fullName(c)}</Link> : "Walk-in"}
            {t && (
              <>
                {" "}
                · ticket{" "}
                <Link href={`/tickets/${t.id}`} className={ui.link}>
                  {ticketLabel(shop.ticket_prefix, t.number)}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/print/invoice/${inv.id}`} target="_blank" className={ui.btn}>
            Print / PDF
          </Link>
        </div>
      </div>

      {inv.status === "void" && <p className="rounded-lg bg-zinc-100 p-3 text-sm font-semibold text-zinc-700">This invoice was voided on {dateTime(inv.voided_at)}.</p>}

      <section className={ui.card}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="pb-2">Item</th>
              <th className="pb-2 text-right">Qty</th>
              <th className="pb-2 text-right">Price</th>
              <th className="pb-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {(items ?? []).map((i) => (
              <tr key={i.id}>
                <td className="py-2">
                  {i.description}
                  {i.imei_serial && <div className="text-xs text-zinc-500">IMEI/serial: {i.imei_serial}</div>}
                  {!i.taxable && <div className="text-xs text-zinc-500">No tax</div>}
                </td>
                <td className="py-2 text-right">{Number(i.qty)}</td>
                <td className="py-2 text-right">{money(i.unit_price)}</td>
                <td className="py-2 text-right">{money(i.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
          <R k="Subtotal" v={money(inv.subtotal)} />
          {Number(inv.discount) > 0 && <R k="Discount" v={`− ${money(inv.discount)}`} />}
          <R k={shop.tax_name ?? "HST"} v={money(inv.tax)} />
          <div className="flex justify-between border-t border-zinc-200 pt-1 font-bold">
            <span>Total</span>
            <span>{money(inv.total)}</span>
          </div>
          <R k="Paid" v={money(inv.paid)} />
          <div className="flex justify-between font-semibold text-brand-dark">
            <span>{due < -0.004 ? "Change / credit owed" : "Due"}</span>
            <span>{money(Math.abs(due))}</span>
          </div>
        </div>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <section className={ui.card}>
          <h2 className={`${ui.h2} mb-3`}>Payments</h2>
          <ul className="space-y-1 text-sm">
            {(payments ?? []).map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>
                  {PAYMENT_METHODS.find((m) => m.key === p.method)?.label ?? p.method}
                  {p.reference ? ` · ${p.reference}` : ""} · <span className="text-zinc-500">{dateTime(p.created_at)}</span>
                </span>
                <span>{money(p.amount)}</span>
              </li>
            ))}
            {!payments?.length && <li className={ui.muted}>No payments yet.</li>}
          </ul>
          {inv.status !== "void" && due > 0.004 && (
            <form action={addPayment} className="mt-4 grid grid-cols-2 gap-2">
              <input type="hidden" name="invoice_id" value={inv.id} />
              <select name="method" className={ui.input} defaultValue="debit">
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
              <input name="amount" type="number" step="0.01" defaultValue={due.toFixed(2)} className={ui.input} />
              <button className={`${ui.btn} col-span-2`}>Record payment</button>
            </form>
          )}
        </section>

        <section className={ui.card}>
          <h2 className={`${ui.h2} mb-2`}>Customer</h2>
          {c ? (
            <>
              <p className="font-medium">{fullName(c)}</p>
              <p className="text-sm text-zinc-600">{phonePretty(c.phone)}</p>
              <p className="text-sm text-zinc-600">{c.email}</p>
            </>
          ) : (
            <p className={ui.muted}>Walk-in sale</p>
          )}
          {inv.notes && <p className="mt-3 text-sm text-zinc-700">Note: {inv.notes}</p>}
          {canManage(staff) && inv.status !== "void" && (
            <form action={voidInvoice} className="mt-4">
              <input type="hidden" name="invoice_id" value={inv.id} />
              <button className={ui.btnDanger}>Void invoice</button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

function R({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-zinc-600">{k}</span>
      <span>{v}</span>
    </div>
  );
}
