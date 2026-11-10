import Link from "next/link";
import { requireStaff } from "@/lib/session";
import { fullName, phonePretty, deviceName, ticketLabel } from "@/lib/format";
import { ui } from "@/lib/ui";
import InvoiceBuilder from "@/components/InvoiceBuilder";
import { createInvoice } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewInvoice({ searchParams }: { searchParams: Promise<{ ticket?: string; customer?: string }> }) {
  const { ticket, customer } = await searchParams;
  const { supabase, shop } = await requireStaff();

  let t: any = null;
  if (ticket) {
    const { data } = await supabase.from("tickets").select("id, number, brand, model, device_type, problem, imei_serial, estimate, deposit, customer_id").eq("id", ticket).single();
    t = data;
  }
  const customerId = t?.customer_id ?? customer ?? null;
  let c: any = null;
  if (customerId) {
    const { data } = await supabase.from("customers").select("id, first_name, last_name, company, phone").eq("id", customerId).single();
    c = data;
  }

  const initialLines = t
    ? [{ description: `${deviceName(t)}: ${t.problem}`, qty: 1, unit_price: Number(t.estimate ?? 0), taxable: true, imei_serial: t.imei_serial ?? "" }]
    : [];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className={ui.h1}>New invoice</h1>
        <p className={ui.muted}>
          {c ? (
            <>
              For <span className="font-medium text-zinc-900">{fullName(c)}</span> {phonePretty(c.phone)}
            </>
          ) : (
            <>
              Walk-in sale (no customer).{" "}
              <Link href="/customers" className={ui.link}>
                Pick a customer
              </Link>{" "}
              first if you want it on their file.
            </>
          )}
          {t && <> · ticket {ticketLabel(shop.ticket_prefix, t.number)}</>}
        </p>
      </div>
      <InvoiceBuilder
        action={createInvoice}
        initialLines={initialLines}
        taxRate={Number(shop.tax_rate ?? 0.13)}
        taxName={shop.tax_name ?? "HST"}
        deposit={Number(t?.deposit ?? 0)}
        customerId={c?.id ?? null}
        ticketId={t?.id ?? null}
      />
    </div>
  );
}
