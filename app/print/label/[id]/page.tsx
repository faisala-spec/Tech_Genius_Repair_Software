import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/session";
import { fullName, deviceName, ticketLabel, dateOnly, phonePretty } from "@/lib/format";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

// Brother QL-800, 62 mm wide. Page is 62 × 29 mm, which fits both DK-1209 (62 × 29 mm
// die-cut labels) and DK-2205 (62 mm continuous roll; the printer cuts after 29 mm).
// Setup steps for the counter PC: docs/PRINTING.md
export default async function PrintLabel({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, shop } = await requireStaff();
  const { data: t } = await supabase
    .from("tickets")
    .select("number, brand, model, device_type, problem, created_at, customers(first_name, last_name, company, phone)")
    .eq("id", id)
    .single();
  if (!t) notFound();

  const c = t.customers as any;
  const line: React.CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.15 };

  return (
    <>
      <style>{`
        @page { size: 62mm 29mm; margin: 0; }
        html, body { margin: 0; padding: 0; background: white; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #000 !important; }
      `}</style>
      <PrintButton auto label="Print label" />
      <div
        style={{
          width: "62mm",
          height: "29mm",
          padding: "1.8mm 3mm 1.5mm",
          boxSizing: "border-box",
          fontFamily: "Arial, Helvetica, sans-serif",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          gap: "0.4mm",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: "17pt", fontWeight: 800, letterSpacing: "0.3pt", lineHeight: 1 }}>{ticketLabel(shop.ticket_prefix, t.number)}</span>
          <span style={{ fontSize: "7pt" }}>{dateOnly(t.created_at)}</span>
        </div>
        <div style={{ ...line, fontSize: "10pt", fontWeight: 700 }}>{fullName(c)}</div>
        <div style={{ ...line, fontSize: "9pt" }}>{phonePretty(c?.phone)}</div>
        <div style={{ ...line, fontSize: "8pt" }}>
          {deviceName(t)} · {t.problem}
        </div>
      </div>
    </>
  );
}
