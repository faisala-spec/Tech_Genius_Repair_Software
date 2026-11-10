import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/session";
import { fullName, deviceName, ticketLabel, dateOnly, phonePretty } from "@/lib/format";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

// Sized for the Brother QL-800 with 62 mm tape (DK-2205 continuous or DK-1209 62 × 29 mm labels).
export default async function PrintLabel({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, shop } = await requireStaff();
  const { data: t } = await supabase
    .from("tickets")
    .select("number, brand, model, device_type, problem, created_at, customers(first_name, last_name, company, phone)")
    .eq("id", id)
    .single();
  if (!t) notFound();

  return (
    <>
      <style>{`@page { size: 62mm 29mm; margin: 0; } body { margin: 0; background: white; }`}</style>
      <PrintButton auto label="Print label" />
      <div style={{ width: "62mm", height: "29mm", padding: "1.5mm 2.5mm", boxSizing: "border-box", fontFamily: "Arial, sans-serif", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: "15pt", fontWeight: 700 }}>{ticketLabel(shop.ticket_prefix, t.number)}</span>
          <span style={{ fontSize: "7pt" }}>{dateOnly(t.created_at)}</span>
        </div>
        <div style={{ fontSize: "9pt", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fullName(t.customers as any)}</div>
        <div style={{ fontSize: "8pt" }}>{phonePretty((t.customers as any)?.phone)}</div>
        <div style={{ fontSize: "8pt", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {deviceName(t)} · {t.problem}
        </div>
      </div>
    </>
  );
}
