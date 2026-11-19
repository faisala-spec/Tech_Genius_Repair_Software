import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireStaff, canManage } from "@/lib/session";
import { fullName, dateTime, dateOnly, phonePretty, ticketLabel, methodLabel, PAYMENT_KIND_LABEL } from "@/lib/format";
import { cents } from "@/lib/money";
import { ui } from "@/lib/ui";
import InvoiceStatus from "@/components/InvoiceStatus";
import { PaymentForm, VoidForm, CreditNoteForm } from "@/components/InvoiceActions";

export const dynamic = "force-dynamic";

const ITEM_COLS =
  "id, line_no, category, description, imei_serial, qty, unit_price_cents, gross_cents, discount_cents, net_cents, tax_code, tax_cents, credited_qty";

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const { id } = await params;
  const { new: isNew } = await searchParams;
  const { supabase, staff, shop } = await requireStaff();
  if (staff.role === "technician") redirect("/");
  const manager = canManage(staff);

  const { data: inv } = await supabase
    .from("invoices")
    .select("*, customers(id, first_name, last_name, company, phone, email), tickets(id, number)")
    .eq("id", id)
    .single();
  if (!inv) notFound();

  const [{ data: items }, { data: payments }, { data: credits }, costs] = await Promise.all([
    supabase.from("invoice_items").select(ITEM_COLS).eq("invoice_id", id).order("line_no"),
    supabase.from("payments").select("id, kind, method, amount_cents, applied_cents, rounding_cents, reference, created_at").eq("invoice_id", id).order("created_at"),
    supabase.from("credit_notes").select("id, number, issue_date, reason, total_cents").eq("invoice_id", id).order("number"),
    manager ? supabase.rpc("invoice_item_costs", { p_invoice_id: id }) : Promise.resolve({ data: [] as any[] }),
  ]);

  const n = (v: unknown) => Number(v ?? 0);
  const balance = n(inv.total_cents) - n(inv.paid_cents) - n(inv.credited_cents);
  const c: any = inv.customers;
  const t: any = inv.tickets;
  const costOf = new Map<string, number>((costs.data ?? []).map((r: any) => [String(r.invoice_item_id), n(r.unit_cost_cents)] as [string, number]));
  const partCost = (items ?? []).reduce((a, i: any) => a + (costOf.get(i.id) ?? 0) * (n(i.qty) - n(i.credited_qty)), 0);
  // Voiding is only for invoices no one has paid (a deposit goes back on the ticket).
  const canVoid = n(inv.credited_cents) === 0 && !(payments ?? []).some((p: any) => p.kind === "payment" || p.kind === "refund");

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {isNew && <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">Invoice #{inv.number} saved.</div>}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className={ui.h1}>Invoice #{inv.number}</h1>
            <InvoiceStatus status={inv.status} />
          </div>
          <p className={ui.muted}>
            {dateOnly(inv.issue_date)} · {c ? <Link href={`/customers/${c.id}`} className={ui.link}>{fullName(c)}</Link> : "Walk-in"}
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
        <Link href={`/print/invoice/${inv.id}`} target="_blank" className={ui.btn}>
          Print / PDF
        </Link>
      </div>

      {inv.status === "void" && (
        <p className="rounded-lg bg-zinc-100 p-3 text-sm text-zinc-700">
          <b>Voided</b> {dateTime(inv.voided_at)}: {inv.void_reason}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <section className={`${ui.card} lg:col-span-2`}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="pb-2">Item</th>
                <th className="pb-2 text-right">Qty</th>
                <th className="pb-2 text-right">Price</th>
                <th className="pb-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {(items ?? []).map((i: any) => (
                <tr key={i.id}>
                  <td className="py-2">
                    {i.description}
                    <div className="text-xs text-zinc-500">
                      {[
                        i.category[0].toUpperCase() + i.category.slice(1),
                        i.imei_serial && `IMEI/serial ${i.imei_serial}`,
                        i.tax_code === "EXEMPT" && "no tax",
                        n(i.credited_qty) > 0 && `${i.credited_qty} returned`,
                        manager && costOf.get(i.id) ? `part cost ${cents(costOf.get(i.id))}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </td>
                  <td className="py-2 text-right">{i.qty}</td>
                  <td className="py-2 text-right">{cents(i.unit_price_cents)}</td>
                  <td className="py-2 text-right">{cents(i.gross_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
            <R k="Subtotal" v={cents(inv.subtotal_cents)} />
            {n(inv.discount_cents) > 0 && <R k="Discount" v={`− ${cents(inv.discount_cents)}`} />}
            <R k={`${inv.tax_name} ${(Number(inv.tax_rate) * 100).toFixed(0)}%`} v={cents(inv.tax_cents)} />
            <div className="flex justify-between border-t border-zinc-200 pt-1 font-bold">
              <dt>Total</dt>
              <dd>{cents(inv.total_cents)}</dd>
            </div>
            {n(inv.credited_cents) > 0 && <R k="Credited" v={`− ${cents(inv.credited_cents)}`} />}
            <R k="Paid" v={`− ${cents(inv.paid_cents)}`} />
            <div className="flex justify-between text-base font-semibold text-brand-dark">
              <dt>Balance</dt>
              <dd>{cents(balance)}</dd>
            </div>
          </dl>
          {manager && partCost > 0 && (
            <p className="mt-3 text-right text-xs text-zinc-500">
              Part costs {cents(partCost)} · profit before overhead {cents(n(inv.subtotal_cents) - n(inv.discount_cents) - partCost)} (owner/manager only)
            </p>
          )}
        </section>

        <div className="space-y-5">
          {inv.status !== "void" && balance > 0 && (
            <section className={ui.card}>
              <h2 className={`${ui.h2} mb-3`}>Receive payment</h2>
              <PaymentForm invoiceId={inv.id} balanceCents={balance} />
            </section>
          )}

          <section className={ui.card}>
            <h2 className={`${ui.h2} mb-3`}>Payments</h2>
            <ul className="space-y-2 text-sm">
              {(payments ?? []).map((p: any) => (
                <li key={p.id} className="flex justify-between gap-3">
                  <span className="min-w-0">
                    {PAYMENT_KIND_LABEL[p.kind] ?? p.kind}
                    {p.method && ` · ${methodLabel(p.method)}`}
                    {p.reference && <span className="text-zinc-500"> · {p.reference}</span>}
                    <span className="block text-xs text-zinc-500">
                      {dateTime(p.created_at)}
                      {n(p.rounding_cents) !== 0 && ` · rounded ${cents(p.rounding_cents)}`}
                    </span>
                  </span>
                  <span className={p.kind === "refund" || p.kind === "deposit_unapplied" ? "text-red-700" : ""}>
                    {p.kind === "refund" || p.kind === "deposit_unapplied" ? "− " : ""}
                    {cents(p.amount_cents)}
                  </span>
                </li>
              ))}
              {!payments?.length && <li className={ui.muted}>No payments yet.</li>}
            </ul>
          </section>

          {!!credits?.length && (
            <section className={ui.card}>
              <h2 className={`${ui.h2} mb-3`}>Credit notes</h2>
              <ul className="space-y-2 text-sm">
                {credits.map((cn: any) => (
                  <li key={cn.id} className="flex justify-between gap-3">
                    <span>
                      CN-{cn.number} · {cn.reason}
                      <span className="block text-xs text-zinc-500">{dateOnly(cn.issue_date)}</span>
                    </span>
                    <span>− {cents(cn.total_cents)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className={`${ui.card} space-y-3`}>
            <h2 className={ui.h2}>Customer</h2>
            {c ? (
              <div className="text-sm">
                <p className="font-medium">{fullName(c)}</p>
                <p className="text-zinc-600">{phonePretty(c.phone)}</p>
                <p className="text-zinc-600">{c.email}</p>
              </div>
            ) : (
              <p className={ui.muted}>Walk-in sale</p>
            )}
            {inv.notes && <p className="text-sm text-zinc-700">Note: {inv.notes}</p>}
            {manager && inv.status !== "void" && (
              <div className="flex flex-wrap gap-2 border-t border-zinc-100 pt-3">
                <CreditNoteForm invoiceId={inv.id} items={(items ?? []) as any} paidCents={n(inv.paid_cents)} balanceCents={balance} />
                {canVoid && <VoidForm invoiceId={inv.id} />}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function R({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-zinc-600">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
