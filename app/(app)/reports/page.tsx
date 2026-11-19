import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff, canManage } from "@/lib/session";
import { dateOnly, dateTime, methodLabel, ticketLabel } from "@/lib/format";
import { cents } from "@/lib/money";
import { ui } from "@/lib/ui";
import PrintButton from "@/components/PrintButton";
import { REPORTS, presets, isDate, loadReport, type ReportKey } from "@/lib/reports";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ r?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const { supabase, staff, shop } = await requireStaff();
  if (!canManage(staff)) redirect("/");

  const today = String((await supabase.rpc("shop_today")).data);
  const r: ReportKey = sp.r && sp.r in REPORTS ? (sp.r as ReportKey) : "pnl";
  const p = presets(today);
  const from = isDate(sp.from) ? sp.from! : p[0].from;
  const to = isDate(sp.to) ? sp.to! : today;
  const q = (patch: Record<string, string>) => `/reports?${new URLSearchParams({ r, from, to, ...patch })}`;
  const { data, error } = await loadReport(supabase, r, from, to);

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <h1 className={ui.h1}>Reports</h1>
        <div className="flex gap-2">
          <a href={`/reports/csv?${new URLSearchParams({ r, from, to })}`} className={ui.btnGhost}>
            Download CSV
          </a>
        </div>
      </div>

      <nav className="no-print flex flex-wrap gap-1 border-b border-zinc-200">
        {(Object.keys(REPORTS) as ReportKey[]).map((k) => (
          <Link key={k} href={q({ r: k })} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${k === r ? "border-brand text-brand-dark" : "border-transparent text-zinc-600 hover:text-zinc-900"}`}>
            {REPORTS[k].label}
          </Link>
        ))}
      </nav>

      <div className="no-print flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1">
          {p.map((x) => (
            <Link key={x.key} href={q({ from: x.from, to: x.to })} className={`rounded-full px-3 py-1 text-xs font-semibold ${x.from === from && x.to === to ? "bg-brand text-white" : "bg-surface text-zinc-600 ring-1 ring-zinc-200 hover:ring-brand"}`}>
              {x.label}
            </Link>
          ))}
        </div>
        <form className="flex items-end gap-2">
          <input type="hidden" name="r" value={r} />
          {REPORTS[r].range && (
            <label className="text-xs text-zinc-500">
              From
              <input type="date" name="from" defaultValue={from} className={`${ui.input} mt-1 w-40`} />
            </label>
          )}
          <label className="text-xs text-zinc-500">
            {REPORTS[r].range ? "To" : "As of"}
            <input type="date" name="to" defaultValue={to} className={`${ui.input} mt-1 w-40`} />
          </label>
          {!REPORTS[r].range && <input type="hidden" name="from" value={from} />}
          <button className={ui.btnGhost}>Show</button>
        </form>
      </div>

      <section className={`${ui.card} print:border-0 print:shadow-none`}>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">{REPORTS[r].label}</h2>
            <p className={ui.muted}>
              {shop.legal_name || shop.name} · {REPORTS[r].range ? `${dateOnly(from)} – ${dateOnly(to)}` : `as of ${dateOnly(to)}`}
            </p>
          </div>
          <div className="no-print">
            <PrintButton label="Print" inline />
          </div>
        </div>
        {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error.message}</p> : <Report r={r} data={data} prefix={shop.ticket_prefix} />}
      </section>
    </div>
  );
}

const n = (v: unknown) => Number(v ?? 0);

function Report({ r, data, prefix }: { r: ReportKey; data: any; prefix: string }) {
  const rows = (Array.isArray(data) ? data : []) as any[];
  switch (r) {
    case "pnl": {
      const sec = (s: string) => rows.filter((x) => x.section === s);
      const sum = (s: string) => sec(s).reduce((a, x) => a + n(x.amount_cents), 0);
      const gross = sum("income") - sum("cost_of_sales");
      const net = gross - sum("expense");
      return (
        <Statement
          blocks={[
            { title: "Sales", rows: sec("income"), total: ["Total sales", sum("income")] },
            { title: "Cost of repairs", rows: sec("cost_of_sales"), total: ["Total cost of repairs", sum("cost_of_sales")] },
            { title: null, rows: [], total: ["Gross profit", gross], big: true },
            { title: "Expenses", rows: sec("expense"), total: ["Total expenses", sum("expense")] },
            { title: null, rows: [], total: ["Net profit", net], big: true },
          ]}
        />
      );
    }
    case "balance": {
      const sec = (s: string) => rows.filter((x) => x.section === s);
      const sum = (s: string) => sec(s).reduce((a, x) => a + n(x.amount_cents), 0);
      const ok = sum("asset") === sum("liability") + sum("equity");
      return (
        <>
          <Statement
            blocks={[
              { title: "What the shop has", rows: sec("asset"), total: ["Total assets", sum("asset")], big: true },
              { title: "What the shop owes", rows: sec("liability"), total: ["Total liabilities", sum("liability")] },
              { title: "Owner's share", rows: sec("equity"), total: ["Total equity", sum("equity")] },
              { title: null, rows: [], total: ["Liabilities + equity", sum("liability") + sum("equity")], big: true },
            ]}
          />
          <p className={`mt-3 text-sm ${ok ? "text-green-800" : "font-semibold text-red-700"}`}>{ok ? "✓ Balanced: assets = liabilities + equity." : "Not balanced. Contact support."}</p>
        </>
      );
    }
    case "hst": {
      const h = data ?? {};
      const line = (no: string, label: string, v: number, strong = false) => (
        <tr className={strong ? "font-bold" : ""}>
          <td className="py-2 pr-3 text-zinc-500">{no}</td>
          <td className="py-2">{label}</td>
          <td className="py-2 text-right">{cents(v)}</td>
        </tr>
      );
      return (
        <>
          <table className="w-full max-w-xl text-sm">
            <tbody className="divide-y divide-zinc-100">
              {line("101", "Sales and other revenue (before tax)", n(h.line_101_sales_cents))}
              {line("103", "HST collected from customers", n(h.line_103_hst_collected_cents))}
              {line("105", "Total HST to account for", n(h.line_105_total_cents))}
              {line("106", "HST paid on expenses (input tax credits)", n(h.line_106_itc_cents))}
              {line("108", "Total input tax credits", n(h.line_108_total_itc_cents))}
              {line("109", n(h.line_109_net_tax_cents) >= 0 ? "Net tax to pay CRA" : "Refund from CRA", n(h.line_109_net_tax_cents), true)}
            </tbody>
          </table>
          {n(h.itcs_without_receipt) > 0 && (
            <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">
              {h.itcs_without_receipt} expense{n(h.itcs_without_receipt) === 1 ? "" : "s"} claim {cents(h.itcs_without_receipt_cents)} of HST without a receipt. CRA can refuse these; find the receipts.
            </p>
          )}
          <p className="mt-3 text-xs text-zinc-500">Regular method. Line numbers match the CRA GST/HST return. Have your accountant review before filing.</p>
        </>
      );
    }
    case "payments": {
      const tot = rows.reduce((a, x) => a + n(x.net_cents), 0);
      return (
        <Table
          head={["Method", "Payments", "Deposits", "Refunds", "Net taken", "#"]}
          rows={rows.map((x) => [methodLabel(x.method), cents(x.payments_cents), cents(x.deposits_cents), x.refunds_cents ? `− ${cents(x.refunds_cents)}` : "—", cents(x.net_cents), x.count])}
          foot={["Total", "", "", "", cents(tot), ""]}
          right={[1, 2, 3, 4, 5]}
        />
      );
    }
    case "unpaid": {
      const tot = rows.reduce((a, x) => a + n(x.balance_cents), 0);
      const bucket = (d: number) => (d <= 30 ? "0–30 days" : d <= 60 ? "31–60" : d <= 90 ? "61–90" : "90+ days");
      return (
        <Table
          head={["Invoice", "Date", "Customer", "Age", "Owing"]}
          rows={rows.map((x) => [
            <Link key={x.invoice_id} href={`/invoices/${x.invoice_id}`} className={ui.link}>
              #{x.number}
            </Link>,
            dateOnly(x.issue_date),
            x.customer,
            <span key="a" className={x.days_old > 30 ? "font-semibold text-red-700" : ""}>{bucket(x.days_old)}</span>,
            cents(x.balance_cents),
          ])}
          foot={["Total owing", "", "", "", cents(tot)]}
          right={[4]}
        />
      );
    }
    case "expenses": {
      const live = rows.filter((x) => !x.voided);
      return (
        <Table
          head={["Date", "Vendor", "Category", "HST", "Total"]}
          rows={live.map((x) => [dateOnly(x.expense_date), x.vendor, x.category, x.claim_itc ? cents(x.hst_cents) : "—", cents(x.total_cents)])}
          foot={["Total", "", "", cents(live.filter((x) => x.claim_itc).reduce((a, x) => a + n(x.hst_cents), 0)), cents(live.reduce((a, x) => a + n(x.total_cents), 0))]}
          right={[3, 4]}
        />
      );
    }
    case "profit": {
      const sum = (k: string) => rows.reduce((a, x) => a + n(x[k]), 0);
      return (
        <>
          <Table
            head={["Ticket", "Customer", "Device", "Charged", "Parts", "Outsourced", "Profit"]}
            rows={rows.map((x) => [
              <Link key={x.ticket_id} href={`/tickets/${x.ticket_id}`} className={ui.link}>
                {ticketLabel(prefix, x.ticket_number)}
              </Link>,
              x.customer,
              x.device,
              cents(x.revenue_cents),
              cents(x.parts_cents),
              cents(x.outsourced_cents),
              <span key="p" className={n(x.profit_cents) < 0 ? "font-semibold text-red-700" : "font-semibold"}>{cents(x.profit_cents)}</span>,
            ])}
            foot={["Total", "", "", cents(sum("revenue_cents")), cents(sum("parts_cents")), cents(sum("outsourced_cents")), cents(sum("profit_cents"))]}
            right={[3, 4, 5, 6]}
          />
          <p className="mt-3 text-xs text-zinc-500">Charged = invoice lines before tax, after discounts and returns. Parts = "Part cost" typed on the invoice. Outsourced = expenses linked to the ticket. Wages and rent aren't split per repair.</p>
        </>
      );
    }
    case "cash": {
      return (
        <Table
          head={["Opened", "By", "Closed", "By", "Expected", "Counted", "Over / short"]}
          rows={rows.map((x) => [
            dateTime(x.opened_at),
            x.opened_by,
            x.closed_at ? dateTime(x.closed_at) : "open",
            x.closed_by ?? "",
            x.close_expected_cents != null ? cents(x.close_expected_cents) : "—",
            x.close_counted_cents != null ? cents(x.close_counted_cents) : "—",
            x.over_short_cents == null ? "—" : n(x.over_short_cents) === 0 ? "✓" : cents(x.over_short_cents),
          ])}
          foot={["Total over / short", "", "", "", "", "", cents(rows.reduce((a, x) => a + n(x.over_short_cents), 0))]}
          right={[4, 5, 6]}
        />
      );
    }
  }
}

function Statement({ blocks }: { blocks: { title: string | null; rows: any[]; total: [string, number]; big?: boolean }[] }) {
  return (
    <table className="w-full max-w-2xl text-sm">
      {blocks.map((b, i) => (
        <tbody key={i}>
          {b.title && (
            <tr>
              <td colSpan={2} className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {b.title}
              </td>
            </tr>
          )}
          {b.rows.map((x) => (
            <tr key={x.code + x.name}>
              <td className="py-1 pl-3 text-zinc-700">{x.name}</td>
              <td className="py-1 text-right">{cents(x.amount_cents)}</td>
            </tr>
          ))}
          {b.title && !b.rows.length && (
            <tr>
              <td className="py-1 pl-3 text-zinc-400">Nothing yet</td>
              <td />
            </tr>
          )}
          <tr className={b.big ? "border-t-2 border-zinc-900 text-base font-bold" : "border-t border-zinc-200 font-semibold"}>
            <td className="py-2">{b.total[0]}</td>
            <td className={`py-2 text-right ${b.total[1] < 0 ? "text-red-700" : ""}`}>{cents(b.total[1])}</td>
          </tr>
        </tbody>
      ))}
    </table>
  );
}

function Table({ head, rows, foot, right }: { head: string[]; rows: React.ReactNode[][]; foot?: React.ReactNode[]; right: number[] }) {
  const align = (i: number) => (right.includes(i) ? "text-right" : "");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            {head.map((h, i) => (
              <th key={h + i} className={`pb-2 pr-3 ${align(i)}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((r, j) => (
            <tr key={j}>
              {r.map((c, i) => (
                <td key={i} className={`py-2 pr-3 ${align(i)}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={head.length} className="py-8 text-center text-zinc-500">
                Nothing in this period.
              </td>
            </tr>
          )}
        </tbody>
        {foot && rows.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-zinc-900 font-bold">
              {foot.map((c, i) => (
                <td key={i} className={`py-2 pr-3 ${align(i)}`}>
                  {c}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
