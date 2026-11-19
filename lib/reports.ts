// Shared by the Reports screen and its CSV download: which reports exist, date presets, and loading.
import type { SupabaseClient } from "@supabase/supabase-js";

export const REPORTS = {
  pnl: { label: "Profit & loss", range: true },
  balance: { label: "Balance sheet", range: false },
  hst: { label: "HST return", range: true },
  payments: { label: "Money taken", range: true },
  unpaid: { label: "Unpaid invoices", range: false },
  expenses: { label: "Expenses", range: true },
  profit: { label: "Profit per repair", range: true },
  cash: { label: "Cash drawer", range: true },
} as const;
export type ReportKey = keyof typeof REPORTS;

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => {
  const x = new Date(Date.UTC(y, m - 1, d));
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
};

/** Quick ranges, all relative to the shop's today (YYYY-MM-DD). */
export function presets(today: string) {
  const [y, m] = today.split("-").map(Number);
  const q = Math.floor((m - 1) / 3);
  return [
    { key: "month", label: "This month", from: ymd(y, m, 1), to: today },
    { key: "last_month", label: "Last month", from: ymd(y, m - 1, 1), to: ymd(y, m, 0) },
    { key: "quarter", label: "This quarter", from: ymd(y, q * 3 + 1, 1), to: today },
    { key: "last_quarter", label: "Last quarter", from: ymd(y, q * 3 - 2, 1), to: ymd(y, q * 3 + 1, 0) },
    { key: "year", label: "This year", from: ymd(y, 1, 1), to: today },
    { key: "last_year", label: "Last year", from: ymd(y - 1, 1, 1), to: ymd(y - 1, 12, 31) },
  ];
}

export const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Runs the database report. Every amount comes back in whole cents. */
export async function loadReport(supabase: SupabaseClient, r: ReportKey, from: string, to: string) {
  switch (r) {
    case "pnl":
      return supabase.rpc("report_pnl", { p_from: from, p_to: to });
    case "balance":
      return supabase.rpc("report_balance_sheet", { p_as_of: to });
    case "hst":
      return supabase.rpc("report_hst", { p_from: from, p_to: to });
    case "payments":
      return supabase.rpc("report_payments", { p_from: from, p_to: to });
    case "unpaid":
      return supabase.rpc("report_ar_aging", { p_as_of: to });
    case "expenses":
      return supabase.rpc("report_expenses", { p_from: from, p_to: to });
    case "profit":
      return supabase.rpc("report_ticket_profit", { p_from: from, p_to: to });
    case "cash":
      return supabase.rpc("report_cash", { p_from: from, p_to: to });
  }
}

/** Cents → "1234.56" for spreadsheets (no float maths). */
export function csvMoney(c: number | string | null | undefined) {
  if (c === null || c === undefined || c === "") return "";
  const n = Number(c);
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  return `${sign}${Math.floor(a / 100)}.${pad(a % 100)}`;
}
