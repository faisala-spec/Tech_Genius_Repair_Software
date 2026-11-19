import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff, canManage } from "@/lib/session";
import { dateOnly } from "@/lib/format";
import { cents } from "@/lib/money";
import { ui } from "@/lib/ui";
import ExpenseForm, { VoidExpenseButton } from "@/components/ExpenseForm";

export const dynamic = "force-dynamic";

const PAID_LABEL: Record<string, string> = { bank: "Bank", credit_card: "Business card", cash_drawer: "Cash drawer", owner: "Owner" };

function monthBounds(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}
function shiftMonth(ym: string, by: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ month?: string; add?: string }> }) {
  const sp = await searchParams;
  const { supabase, staff, shop } = await requireStaff();
  if (!canManage(staff)) redirect("/");

  const today = String((await supabase.rpc("shop_today")).data);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : today.slice(0, 7);
  const { from, to } = monthBounds(month);

  const [{ data: rows, error }, { data: cats }] = await Promise.all([
    supabase.rpc("report_expenses", { p_from: from, p_to: to }),
    supabase.from("accounts").select("id, name, itc_allowed, system_key").eq("is_expense_category", true).eq("active", true).order("sort"),
  ]);
  const list = ((rows ?? []) as any[]).filter((r) => !r.voided);
  const total = list.reduce((a, r) => a + Number(r.total_cents), 0);
  const itc = list.filter((r) => r.claim_itc).reduce((a, r) => a + Number(r.hst_cents), 0);
  const catTotals: Record<string, number> = {};
  for (const r of list) catTotals[r.category] = (catTotals[r.category] ?? 0) + Number(r.total_cents);
  const byCat: [string, number][] = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
  const monthName = new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={ui.h1}>Expenses</h1>
        <div className="flex items-center gap-1 text-sm">
          <Link href={`/expenses?month=${shiftMonth(month, -1)}`} className={ui.btnGhost} aria-label="Previous month">
            ‹
          </Link>
          <span className="min-w-36 text-center font-semibold text-zinc-900">{monthName}</span>
          <Link href={`/expenses?month=${shiftMonth(month, 1)}`} className={ui.btnGhost} aria-label="Next month">
            ›
          </Link>
        </div>
      </div>

      <section className={ui.card}>
        <h2 className={`${ui.h2} mb-4`}>Add expense</h2>
        <ExpenseForm categories={(cats ?? []) as any} today={today} taxRate={Number(shop.tax_rate ?? 0.13)} />
      </section>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error.message}</p>}

      <div className="grid gap-5 lg:grid-cols-3">
        <section className={`${ui.card} lg:col-span-2`}>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className={ui.h2}>{monthName}</h2>
            <span className="text-sm text-zinc-500">
              {list.length} expense{list.length === 1 ? "" : "s"} · {cents(total)}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Vendor</th>
                  <th className="pb-2">Category</th>
                  <th className="pb-2">Paid from</th>
                  <th className="pb-2 text-right">HST</th>
                  <th className="pb-2 text-right">Total</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {((rows ?? []) as any[]).map((r) => (
                  <tr key={r.expense_id} className={r.voided ? "text-zinc-400 line-through" : ""}>
                    <td className="py-2 whitespace-nowrap">{dateOnly(r.expense_date)}</td>
                    <td className="py-2">
                      {r.vendor}
                      {r.ticket_number && <span className="ml-1 text-xs text-zinc-500">· T-{r.ticket_number}</span>}
                      {!r.has_receipt && r.claim_itc && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800 no-underline">no receipt</span>}
                    </td>
                    <td className="py-2">{r.category}</td>
                    <td className="py-2">{PAID_LABEL[r.paid_from] ?? r.paid_from}</td>
                    <td className="py-2 text-right">{Number(r.hst_cents) ? cents(r.hst_cents) : "—"}{r.claim_itc ? "" : Number(r.hst_cents) ? " *" : ""}</td>
                    <td className="py-2 text-right font-medium">{cents(r.total_cents)}</td>
                    <td className="py-2 pl-3 text-right">{!r.voided && <VoidExpenseButton id={r.expense_id} />}</td>
                  </tr>
                ))}
                {!rows?.length && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-zinc-500">
                      No expenses in {monthName} yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-zinc-500">* HST not claimed back (not allowed for that category, or not ticked).</p>
        </section>

        <section className={ui.card}>
          <h2 className={`${ui.h2} mb-3`}>By category</h2>
          <ul className="space-y-2.5 text-sm">
            {byCat.map(([k, v]) => (
              <li key={k}>
                <div className="mb-1 flex justify-between">
                  <span className="text-zinc-700">{k}</span>
                  <span className="font-medium">{cents(v)}</span>
                </div>
                <div className="h-2 rounded-full bg-zinc-100">
                  <div className="h-2 rounded-full bg-chart-costs" style={{ width: `${(v / (byCat[0]?.[1] || 1)) * 100}%` }} />
                </div>
              </li>
            ))}
            {!byCat.length && <li className={ui.muted}>Nothing yet.</li>}
          </ul>
          <dl className="mt-4 space-y-1 border-t border-zinc-200 pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-600">Total spent</dt>
              <dd className="font-semibold">{cents(total)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-600">HST to claim back</dt>
              <dd className="font-semibold">{cents(itc)}</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
