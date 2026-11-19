import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff, canManage } from "@/lib/session";
import { fullName, phonePretty, deviceName, ticketLabel } from "@/lib/format";
import { centsToInput } from "@/lib/money";
import { ui } from "@/lib/ui";
import InvoiceBuilder from "@/components/InvoiceBuilder";

export const dynamic = "force-dynamic";

export default async function NewInvoice({ searchParams }: { searchParams: Promise<{ ticket?: string; customer?: string }> }) {
  const { ticket, customer } = await searchParams;
  const { supabase, shop, staff } = await requireStaff();
  if (staff.role === "technician") redirect("/");

  let t: any = null;
  let depositCents = 0;
  if (ticket) {
    const [{ data }, dep] = await Promise.all([
      supabase.from("tickets").select("id, number, brand, model, device_type, problem, imei_serial, estimate_cents, customer_id").eq("id", ticket).single(),
      supabase.rpc("ticket_deposit_cents", { p_ticket_id: ticket }),
    ]);
    t = data;
    depositCents = Number(dep.data ?? 0); // from the ledger: what this customer actually has on deposit
  }
  const customerId = t?.customer_id ?? customer ?? null;
  let c: any = null;
  if (customerId) {
    const { data } = await supabase.from("customers").select("id, first_name, last_name, company, phone").eq("id", customerId).single();
    c = data;
  }

  const initialLines = t
    ? [{ description: `${deviceName(t)}: ${t.problem}`, category: "repair", qty: "1", price: t.estimate_cents != null ? centsToInput(t.estimate_cents) : "", cost: "", taxable: true, imei: t.imei_serial ?? "" }]
    : [];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className={ui.h1}>{t ? "Invoice for repair" : "New sale"}</h1>
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
              first to keep it on their file.
            </>
          )}
          {t && <> · ticket {ticketLabel(shop.ticket_prefix, t.number)}</>}
        </p>
      </div>
      <InvoiceBuilder
        initialLines={initialLines}
        taxRate={Number(shop.tax_rate ?? 0.13)}
        taxName={shop.tax_name ?? "HST"}
        depositCents={depositCents}
        customerId={c?.id ?? null}
        ticketId={t?.id ?? null}
        showCost={canManage(staff)}
      />
    </div>
  );
}
