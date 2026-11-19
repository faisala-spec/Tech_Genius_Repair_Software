import { redirect } from "next/navigation";
import { requireStaff, canManage } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { cents } from "@/lib/money";
import { ui } from "@/lib/ui";
import { OpenDrawerForm, CloseDrawerForm, MoveCashForm } from "@/components/CashDrawer";

export const dynamic = "force-dynamic";

export default async function CashPage() {
  const { supabase, staff } = await requireStaff();
  if (staff.role === "technician") redirect("/");
  const manager = canManage(staff);

  const today = String((await supabase.rpc("shop_today")).data);
  const monthAgo = new Date(today + "T12:00:00Z");
  monthAgo.setUTCDate(monthAgo.getUTCDate() - 30);

  const [{ data: status }, { count: sessions }, history] = await Promise.all([
    supabase.rpc("drawer_status"),
    supabase.from("cash_sessions").select("id", { count: "exact", head: true }),
    manager ? supabase.rpc("report_cash", { p_from: monthAgo.toISOString().slice(0, 10), p_to: today }) : Promise.resolve({ data: [] as any[] }),
  ]);
  const s = status as { open: boolean; opened_at?: string; opened_by?: string; expected_cents?: number | null } | null;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={ui.h1}>Cash drawer</h1>
        <span className={`${ui.badge} ${s?.open ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>{s?.open ? "Open" : "Closed"}</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className={`${ui.card} lg:col-span-2`}>
          {s?.open ? (
            <>
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className={ui.h2}>Close the drawer</h2>
                <p className="text-sm text-zinc-500">
                  Opened {dateTime(s.opened_at)} by {s.opened_by}
                </p>
              </div>
              <CloseDrawerForm blind={!manager} />
            </>
          ) : (
            <>
              <h2 className={`${ui.h2} mb-4`}>Open the drawer</h2>
              <OpenDrawerForm firstEver={!sessions} />
            </>
          )}
        </section>

        <div className="space-y-5">
          {manager && s?.open && (
            <section className={ui.card}>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Should be in the drawer now</p>
              <p className="mt-1 text-3xl font-bold">{cents(s.expected_cents ?? 0)}</p>
              <p className="mt-1 text-xs text-zinc-500">From the books: float + cash taken − cash paid out. Front desk doesn't see this.</p>
            </section>
          )}
          {manager && s?.open && (
            <section className={ui.card}>
              <h2 className={`${ui.h2} mb-3`}>Cash in / out</h2>
              <MoveCashForm />
            </section>
          )}
          {!s?.open && (
            <section className={`${ui.card} text-sm text-zinc-600`}>
              <p className="font-semibold text-zinc-900">Why open the drawer?</p>
              <p className="mt-1">Cash sales, cash deposits and cash refunds only work while the drawer is open, so every dollar in it is accounted for and any shortage is caught the same day.</p>
            </section>
          )}
        </div>
      </div>

      {manager && (
        <section className={ui.card}>
          <h2 className={`${ui.h2} mb-3`}>Last 30 days</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="pb-2">Opened</th>
                  <th className="pb-2">Closed</th>
                  <th className="pb-2 text-right">Expected</th>
                  <th className="pb-2 text-right">Counted</th>
                  <th className="pb-2 text-right">Over / short</th>
                  <th className="pb-2">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {((history.data ?? []) as any[]).map((r) => {
                  const os = r.over_short_cents == null ? null : Number(r.over_short_cents);
                  return (
                    <tr key={r.session_id}>
                      <td className="py-2">
                        {dateTime(r.opened_at)}
                        <span className="block text-xs text-zinc-500">{r.opened_by}</span>
                      </td>
                      <td className="py-2">
                        {r.closed_at ? dateTime(r.closed_at) : <span className="text-amber-800">still open</span>}
                        <span className="block text-xs text-zinc-500">{r.closed_by}</span>
                      </td>
                      <td className="py-2 text-right">{r.close_expected_cents != null ? cents(r.close_expected_cents) : "—"}</td>
                      <td className="py-2 text-right">{r.close_counted_cents != null ? cents(r.close_counted_cents) : "—"}</td>
                      <td className={`py-2 text-right font-semibold ${os === null || os === 0 ? "" : os < 0 ? "text-red-700" : "text-green-800"}`}>
                        {os === null ? "—" : os === 0 ? "✓ exact" : os < 0 ? `− ${cents(-os)}` : `+ ${cents(os)}`}
                      </td>
                      <td className="py-2 text-zinc-600">{r.note}</td>
                    </tr>
                  );
                })}
                {!history.data?.length && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-zinc-500">
                      No drawer days yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
