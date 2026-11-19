// CSV download of any report, for the accountant. Same database functions as the screen,
// so the numbers are identical. Owner/manager only (the database refuses anyone else).
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { REPORTS, isDate, loadReport, csvMoney, type ReportKey } from "@/lib/reports";

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const r = p.get("r") as ReportKey;
  const from = p.get("from") ?? "";
  const to = p.get("to") ?? "";
  if (!(r in REPORTS) || !isDate(from) || !isDate(to)) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const supabase = await supabaseServer();
  const { data, error } = await loadReport(supabase, r, from, to);
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  // Rows as objects; any column ending in _cents becomes dollars with two decimals.
  const rows: Record<string, unknown>[] = Array.isArray(data) ? data : [data as Record<string, unknown>];
  const cols = rows.length ? Object.keys(rows[0]).filter((c) => !c.endsWith("_id") || c === "invoice_id") : [];
  const header = cols.map((c) => c.replace(/_cents$/, "").replace(/_/g, " "));
  const lines = [header.map(cell).join(",")];
  for (const row of rows) lines.push(cols.map((c) => cell(c.endsWith("_cents") ? csvMoney(row[c] as any) : row[c])).join(","));

  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tech-genius-${r}-${from}-to-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
