import { ui } from "@/lib/ui";

export const INVOICE_STATUS: Record<string, { label: string; style: string }> = {
  unpaid: { label: "Unpaid", style: "bg-red-100 text-red-700" },
  partial: { label: "Part paid", style: "bg-amber-100 text-amber-800" },
  paid: { label: "Paid", style: "bg-green-100 text-green-800" },
  credited: { label: "Credited", style: "bg-sky-100 text-sky-800" },
  void: { label: "Void", style: "bg-zinc-200 text-zinc-600" },
};

export default function InvoiceStatus({ status, overdue }: { status: string; overdue?: boolean }) {
  if (overdue && (status === "unpaid" || status === "partial")) return <span className={`${ui.badge} bg-red-600 text-white`}>Overdue</span>;
  const s = INVOICE_STATUS[status] ?? { label: status, style: "bg-zinc-100 text-zinc-600" };
  return <span className={`${ui.badge} ${s.style}`}>{s.label}</span>;
}
