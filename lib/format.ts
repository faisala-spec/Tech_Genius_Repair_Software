export const STATUSES = [
  { key: "received", label: "Received", color: "bg-slate-100 text-slate-700" },
  { key: "diagnosing", label: "Diagnosing", color: "bg-sky-100 text-sky-800" },
  { key: "awaiting_approval", label: "Waiting for approval", color: "bg-amber-100 text-amber-800" },
  { key: "awaiting_parts", label: "Waiting for parts", color: "bg-purple-100 text-purple-800" },
  { key: "in_repair", label: "In repair", color: "bg-blue-100 text-blue-800" },
  { key: "ready", label: "Ready for pickup", color: "bg-green-100 text-green-800" },
  { key: "picked_up", label: "Picked up", color: "bg-zinc-200 text-zinc-700" },
  { key: "cancelled", label: "Cancelled", color: "bg-red-100 text-red-700" },
] as const;

export type StatusKey = (typeof STATUSES)[number]["key"];
export const ACTIVE_STATUSES = STATUSES.filter((s) => s.key !== "picked_up" && s.key !== "cancelled");

export function statusInfo(key: string) {
  return STATUSES.find((s) => s.key === key) ?? STATUSES[0];
}

export const DEVICE_TYPES = ["Phone", "Tablet", "Laptop", "Desktop", "Console", "Watch", "Drone", "Printer", "Other"];

export const PAYMENT_METHODS = [
  { key: "debit", label: "Debit" },
  { key: "credit", label: "Credit card" },
  { key: "cash", label: "Cash" },
  { key: "etransfer", label: "e-Transfer" },
  { key: "store_credit", label: "Store credit" },
  { key: "other", label: "Other" },
];

const TZ = "America/Toronto";

export function money(n: number | string | null | undefined) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(Number(n || 0));
}

export function dateTime(s: string | null | undefined) {
  if (!s) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }).format(new Date(s));
}

export function dateOnly(s: string | null | undefined) {
  if (!s) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, dateStyle: "medium" }).format(new Date(s));
}

export function phonePretty(p: string | null | undefined) {
  if (!p) return "";
  const d = p.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return p;
}

/** Any typed phone → +1XXXXXXXXXX (or +international). Null if unreadable. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const d = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && d.length >= 8 && d.length <= 15) return "+" + d;
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return null;
}

/** Strip characters that would break a PostgREST filter. */
export function cleanSearch(q: string) {
  return q.replace(/[,()%*\\:"']/g, " ").trim().slice(0, 60);
}

export function fullName(c: { first_name?: string | null; last_name?: string | null; company?: string | null } | null) {
  if (!c) return "";
  const n = [c.first_name, c.last_name].filter(Boolean).join(" ");
  return n || c.company || "Unnamed customer";
}

export function deviceName(t: { brand?: string | null; model?: string | null; device_type?: string | null }) {
  return [t.brand, t.model].filter(Boolean).join(" ") || t.device_type || "Device";
}

export function ticketLabel(prefix: string | null | undefined, n: number) {
  return `${prefix ?? "T-"}${n}`;
}
