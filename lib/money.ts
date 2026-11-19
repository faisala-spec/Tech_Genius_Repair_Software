// Money on screen. The database stores and computes everything in whole cents; this file only
// converts what people type into cents and cents back into "$1,234.56". No float arithmetic.

/** "189.99", "$1,189.9", "189" → 18999 / 118990 / 18900. Returns null if it isn't a valid amount. */
export function toCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().replace(/[$,\s]/g, "");
  if (s === "") return null;
  const m = s.match(/^(\d{1,9})(?:\.(\d{0,2}))?$/);
  if (!m) return null;
  const dollars = Number(m[1]);
  const cents = Number((m[2] ?? "").padEnd(2, "0") || "0");
  return dollars * 100 + cents;
}

/** Like toCents, but blank means 0 and anything invalid throws with a readable message. */
export function requireCents(input: string | null | undefined, label = "Amount"): number {
  if (input === null || input === undefined || String(input).trim() === "") return 0;
  const c = toCents(input);
  if (c === null) throw new Error(`${label}: "${input}" isn't a valid dollar amount`);
  return c;
}

const fmt = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

/** 18999 → "$189.99"; negative → "-$189.99". Accepts the bigint-as-string Postgres sends. */
export function cents(v: number | string | bigint | null | undefined): string {
  const n = Number(v ?? 0);
  return fmt.format(n / 100);
}

/** For inputs: 18999 → "189.99" (no symbol). */
export function centsToInput(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

/** Canada has no pennies: cash rounds to the nearest 5¢ (same rule as the database). */
export function roundNickel(c: number): number {
  return Math.floor((c + 2) / 5) * 5;
}
