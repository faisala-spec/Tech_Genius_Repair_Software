import Link from "next/link";
import { requireStaff } from "@/lib/session";
import { fullName, money, dateTime } from "@/lib/format";
import { ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  paid: "bg-green-100 text-green-800",
  partial: "bg-amber-100 text-amber-800",
  unpaid: "bg-red-100 text-red-700",
  void: "bg-zinc-200 text-zinc-600",
  draft: "bg-zinc-100 text-zinc-600",
};

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const { supabase } = await requireStaff();

  let q = supabase
    .from("invoices")
    .select("id, number, total, paid, status, created_at, customers(first_name, last_name, company)")
    .order("number", { ascending: false })
    .limit(200);
  if (status) q = q.eq("status", status);
  const { data: invoices } = await q;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={ui.h1}>Invoices</h1>
        <Link href="/invoices/new" className={ui.btn}>
          + New sale
        </Link>
      </div>
      <div className="flex flex-wrap gap-2">
        {[
          ["", "All"],
          ["unpaid", "Unpaid"],
          ["partial", "Part paid"],
          ["paid", "Paid"],
          ["void", "Void"],
        ].map(([k, l]) => (
          <Link
            key={k}
            href={k ? `/invoices?status=${k}` : "/invoices"}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${(status ?? "") === k ? "bg-brand text-white" : "bg-white text-zinc-600 ring-1 ring-zinc-200"}`}
          >
            {l}
          </Link>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3">Invoice</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Paid</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {(invoices ?? []).map((i: any) => (
              <tr key={i.id} className="hover:bg-zinc-50">
                <td className="px-4 py-3">
                  <Link href={`/invoices/${i.id}`} className={ui.link}>
                    #{i.number}
                  </Link>
                </td>
                <td className="px-4 py-3 text-zinc-600">{dateTime(i.created_at)}</td>
                <td className="px-4 py-3">{i.customers ? fullName(i.customers) : "Walk-in"}</td>
                <td className="px-4 py-3 text-right">{money(i.total)}</td>
                <td className="px-4 py-3 text-right">{money(i.paid)}</td>
                <td className="px-4 py-3">
                  <span className={`${ui.badge} ${STATUS_STYLE[i.status] ?? ""}`}>{i.status}</span>
                </td>
              </tr>
            ))}
            {!invoices?.length && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-zinc-500">
                  No invoices yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
