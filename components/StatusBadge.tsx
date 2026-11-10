import { statusInfo } from "@/lib/format";
import { ui } from "@/lib/ui";

export default function StatusBadge({ status }: { status: string }) {
  const s = statusInfo(status);
  return <span className={`${ui.badge} ${s.color}`}>{s.label}</span>;
}
