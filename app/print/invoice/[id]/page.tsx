import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/session";
import { fullName, money, dateTime, phonePretty, ticketLabel, PAYMENT_METHODS } from "@/lib/format";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

export default async function PrintInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, shop } = await requireStaff();

  const { data: inv } = await supabase
    .from("invoices")
    .select("*, customers(first_name, last_name, company, phone, email, address, city, province, postal_code), tickets(number)")
    .eq("id", id)
    .single();
  if (!inv) notFound();
  const [{ data: items }, { data: payments }] = await Promise.all([
    supabase.from("invoice_items").select("*").eq("invoice_id", id),
    supabase.from("payments").select("*").eq("invoice_id", id).order("created_at"),
  ]);
  const c: any = inv.customers;
  const t: any = inv.tickets;
  const due = Number(inv.total) - Number(inv.paid);

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-sm text-zinc-900 print:p-0">
      <PrintButton label="Print / Save as PDF" />

      <div className="flex items-start justify-between gap-6">
        <div className="flex gap-4">
          <img src={shop.logo_url || "/brand/techgenius-logo.png"} alt="" className="h-24 w-auto" />
          <div className="leading-5">
            <p className="text-base font-bold">{shop.legal_name || shop.name}</p>
            <p>{shop.address}</p>
            <p>
              {shop.city}, {shop.province}
            </p>
            <p>{phonePretty(shop.phone)}</p>
            <p>{shop.email}</p>
            {shop.tax_number && (
              <p>
                {shop.tax_name}: {shop.tax_number}
              </p>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tracking-wide" style={{ color: shop.brand_color ?? "#e28e34" }}>
            {inv.status === "void" ? "VOID" : "INVOICE"}
          </p>
          <p className="mt-2">
            <b>#{inv.number}</b>
          </p>
          <p>{dateTime(inv.created_at)}</p>
          {t && <p>Ticket {ticketLabel(shop.ticket_prefix, t.number)}</p>}
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-zinc-200 p-3">
        <p className="text-xs font-semibold uppercase text-zinc-500">Bill to</p>
        {c ? (
          <>
            <p className="font-semibold">{fullName(c)}</p>
            {c.phone && <p>{phonePretty(c.phone)}</p>}
            {c.email && <p>{c.email}</p>}
            {c.address && (
              <p>
                {c.address}
                {c.city ? `, ${c.city}` : ""} {c.postal_code ?? ""}
              </p>
            )}
          </>
        ) : (
          <p>Walk-in customer</p>
        )}
      </div>

      <table className="mt-6 w-full">
        <thead>
          <tr className="border-b-2 border-zinc-900 text-left">
            <th className="py-2">Item</th>
            <th className="py-2 text-right">Qty</th>
            <th className="py-2 text-right">Price</th>
            <th className="py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {(items ?? []).map((i) => (
            <tr key={i.id} className="border-b border-zinc-200">
              <td className="py-2">
                {i.description}
                {i.imei_serial && <div className="text-xs text-zinc-500">IMEI/serial: {i.imei_serial}</div>}
              </td>
              <td className="py-2 text-right">{Number(i.qty)}</td>
              <td className="py-2 text-right">{money(i.unit_price)}</td>
              <td className="py-2 text-right">{money(i.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ml-auto mt-4 w-64 space-y-1">
        <L k="Subtotal" v={money(inv.subtotal)} />
        {Number(inv.discount) > 0 && <L k="Discount" v={`− ${money(inv.discount)}`} />}
        <L k={`${shop.tax_name ?? "HST"}`} v={money(inv.tax)} />
        <div className="flex justify-between border-t border-zinc-900 pt-1 text-base font-bold">
          <span>Total</span>
          <span>{money(inv.total)}</span>
        </div>
        {(payments ?? []).map((p) => (
          <L key={p.id} k={`${PAYMENT_METHODS.find((m) => m.key === p.method)?.label ?? p.method}${p.reference ? ` (${p.reference})` : ""}`} v={money(p.amount)} />
        ))}
        <div className="flex justify-between font-bold">
          <span>{due < -0.004 ? "Change / credit owed" : "Balance due"}</span>
          <span>{money(Math.abs(due))}</span>
        </div>
      </div>

      {inv.notes && (
        <p className="mt-6">
          <b>Notes:</b> {inv.notes}
        </p>
      )}

      {shop.invoice_terms && (
        <div className="mt-8 border-t border-zinc-200 pt-3 text-[10px] leading-4 text-zinc-600">
          <p className="mb-1 font-semibold text-zinc-800">Terms &amp; Conditions</p>
          <p className="whitespace-pre-wrap">{shop.invoice_terms}</p>
        </div>
      )}
      <p className="mt-6 text-center text-xs text-zinc-500">Thank you for choosing {shop.name}!</p>
    </div>
  );
}

function L({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
}
