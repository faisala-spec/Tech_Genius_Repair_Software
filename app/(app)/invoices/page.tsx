import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/session";
import { fullName, dateOnly } from "@/lib/format";
import { cents } from "@/lib/money";
import { ui } from "@/lib/ui";
import InvoiceStatus from "@/components/InvoiceStatus";

export const dynamic = "force-dynamic";

const OVERDUE_DAYS = 30;
const FILTERS = [
  ["", "All"],
  ["open", "Unpaid"],
  ["overdue", "Overdue"],
  ["paid", "Paid"],
  ["credited", "Credited"],
  ["void", "Void"],
] as const;

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { status = "", q } = await searchParams;
  const { supabase, staff } = await requireStaff();
  if (staff.role === "technician") redirect("/");

  const today = String((await supabase.rpc("shop_today")).data ?? new Date().toISOString().slice(0, 10));
  const cutoff = new Date(today + "T12:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - OVERDUE_DAYS);
  const overdueBefore = cutoff.toISOString().slice(0, 10);

  // Status bar (QuickBooks style): money still owed, overdue part, and paid in the last 30 days.
  const [{ data: open }, { data: paidRecent }] = await Promise.all([
    supabase.from("invoices").select("total_cents, paid_cents, credited_cents, issue_date").in("status", ["unpaid", "partial"]),
    supabase.from("invoices").select("total_cents").eq("status", "paid").gte("issue_date", overdueBefore),
  ]);
  const owed = (rows: any[]) => rows.reduce((a, i) => a + Number(i.total_cents) - Number(i.paid_cents) - Number(i.credited_cents), 0);
  const openRows = open ?? [];
  const overdueRows = openRows.filter((i: any) => i.issue_date < overdueBefore);
  const bar = {
    overdue: owed(overdueRows),
    notDue: owed(openRows) - owed(overdueRows),
    paid: (paidRecent ?? []).reduce((a: number, i: any) => a + Number(i.total_cents), 0),
  };
  const barTotal = bar.overdue + bar.notDue + bar.paid || 1;

  let query = supabase
    .from("invoices")
    .select("id, number, issue_date, total_cents, paid_cents, credited_cents, status, customers(first_name, last_name, company)")
    .order("number", { ascending: false })
    .limit(200);
  if (status === "open") query = query.in("status", ["unpaid", "partial"]);
  else if (status === "overdue") query = query.in("status", ["unpaid", "partial"]).lt("issue_date", overdueBefore);
  else if (status) query = query.eq("status", status);
  const num = Number(String(q ?? "").replace(/\D/g, ""));
  if (num) query = query.eq("number", num);
  const { data: invoices } = await query;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={ui.h1}>Sales</h1>
        <Link href="/invoices/new" className={ui.btn}>
          + New sale
        </Link>
      </div>

      <section className={ui.card}>
        <div className="grid gap-4 sm:grid-cols-3">
          <BarStat label={`Overdue (${OVERDUE_DAYS}+ days)`} value={bar.overdue} color="bg-red-500" href="/invoices?status=overdue" />
          <BarStat label="Unpaid, not yet due" value={bar.notDue} color="bg-amber-400" href="/invoices?status=open" />
          <BarStat label="Paid, last 30 days" value={bar.paid} color="bg-green-500" href="/invoices?status=paid" />
        </div>
        <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-zinc-100" aria-hidden>
          <div className="bg-red-500" style={{ width: `${(bar.overdue / barTotal) * 100}%` }} />
          <div className="bg-amber-400" style={{ width: `${(bar.notDue / barTotal) * 100}%` }} />
          <div className="bg-green-500" style={{ width: `${(bar.paid / barTotal) * 100}%` }} />
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(([k, l]) => (
            <Link
              key={k}
              href={k ? `/invoices?status=${k}` : "/invoices"}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${status === k ? "bg-brand text-white" : "bg-surface text-zinc-600 ring-1 ring-zinc-200 hover:ring-brand"}`}
            >
              {l}
            </Link>
          ))}
        </div>
        <form className="flex gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <input name="q" defaultValue={q ?? ""} placeholder="Invoice #" className={`${ui.input} w-32`} inputMode="numeric" />
        </form>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3">Invoice</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Balance</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {(invoices ?? []).map((i: any) => {
              const bal = Number(i.total_cents) - Number(i.paid_cents) - Number(i.credited_cents);
              return (
                <tr key={i.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link href={`/invoices/${i.id}`} className={ui.link}>
                      #{i.number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{dateOnly(i.issue_date)}</td>
                  <td className="px-4 py-3">{i.customers ? fullName(i.customers) : "Walk-in"}</td>
                  <td className="px-4 py-3 text-right">{cents(i.total_cents)}</td>
                  <td className="px-4 py-3 text-right">{i.status === "void" ? "—" : cents(bal)}</td>
                  <td className="px-4 py-3">
                    <InvoiceStatus status={i.status} overdue={i.issue_date < overdueBefore} />
                  </td>
                </tr>
              );
            })}
            {!invoices?.length && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-zinc-500">
                  No invoices here yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BarStat({ label, value, color, href }: { label: string; value: number; color: string; href: string }) {
  return (
    <Link href={href} className="block rounded-lg p-1 hover:bg-zinc-50">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-zinc-900">{cents(value)}</p>
    </Link>
  );
}
