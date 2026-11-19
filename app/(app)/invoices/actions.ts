"use server";

// Invoices, payments, credit notes and voids. Every one of these is a single database function
// (db/008_ledger.sql) that checks the person's role and does all the maths. This file only turns
// what was typed into whole cents and passes it on.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/session";
import { requireCents } from "@/lib/money";
import { friendlyError } from "@/lib/format";

export type FormState = { error?: string; ok?: string } | undefined;

export type DraftLine = {
  description: string;
  category: string;
  qty: string | number;
  price: string; // dollars as typed
  cost?: string; // dollars as typed (owner/manager only; never printed)
  taxable: boolean;
  imei?: string;
};

function toDbLines(lines: DraftLine[]) {
  return lines
    .filter((l) => String(l.description ?? "").trim() !== "")
    .map((l, i) => {
      const qty = Number(String(l.qty).trim());
      if (!Number.isInteger(qty) || qty < 1) throw new Error(`Line ${i + 1}: quantity must be a whole number`);
      return {
        description: String(l.description).trim(),
        category: l.category || "repair",
        qty,
        unit_price_cents: requireCents(l.price, `Line ${i + 1} price`),
        unit_cost_cents: requireCents(l.cost ?? "", `Line ${i + 1} part cost`),
        tax_code: l.taxable === false ? "EXEMPT" : "HST",
        imei_serial: l.imei?.trim() || null,
      };
    });
}

/** Live totals while typing. Same database maths as the real invoice, nothing saved. */
export async function quoteInvoice(lines: DraftLine[], discount: string) {
  try {
    const { supabase } = await requireStaff();
    const dbLines = toDbLines(lines);
    if (!dbLines.length) return { quote: null };
    const { data, error } = await supabase.rpc("quote_invoice", { p_lines: dbLines, p_discount_cents: requireCents(discount, "Discount") });
    if (error) return { error: friendlyError(error) };
    return { quote: data as Quote };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}
export type Quote = { subtotal_cents: number; discount_cents: number; tax_cents: number; total_cents: number; taxable_base_cents: number };

export async function createInvoice(_: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await requireStaff();
  let id: string;
  try {
    const lines = toDbLines(JSON.parse(String(f.get("lines") ?? "[]")));
    if (!lines.length) return { error: "Add at least one item." };
    const payments = (JSON.parse(String(f.get("payments") ?? "[]")) as { method: string; amount: string }[])
      .map((p) => ({ method: p.method, amount_cents: requireCents(p.amount, "Payment") }))
      .filter((p) => p.amount_cents > 0);
    const { data, error } = await supabase.rpc("create_invoice", {
      p_customer_id: (f.get("customer_id") as string) || null,
      p_ticket_id: (f.get("ticket_id") as string) || null,
      p_lines: lines,
      p_discount_cents: requireCents(f.get("discount") as string, "Discount"),
      p_payments: payments,
      p_notes: (f.get("notes") as string) || null,
      p_idempotency_key: String(f.get("idempotency_key")),
    });
    if (error) return { error: friendlyError(error) };
    id = (data as any).id;
  } catch (e) {
    return { error: friendlyError(e) };
  }
  const ticketId = f.get("ticket_id") as string;
  revalidatePath("/invoices");
  revalidatePath("/");
  if (ticketId) revalidatePath(`/tickets/${ticketId}`);
  redirect(`/invoices/${id}?new=1`);
}

export async function addPayment(_: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await requireStaff();
  const id = String(f.get("invoice_id"));
  try {
    const { error } = await supabase.rpc("add_payment", {
      p_invoice_id: id,
      p_method: String(f.get("method")),
      p_amount_cents: requireCents(f.get("amount") as string, "Amount"),
      p_reference: (f.get("reference") as string) || null,
      p_idempotency_key: String(f.get("idempotency_key")),
    });
    if (error) return { error: friendlyError(error) };
  } catch (e) {
    return { error: friendlyError(e) };
  }
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  revalidatePath("/");
  return { ok: "Payment recorded." };
}

export async function voidInvoice(_: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await requireStaff();
  const id = String(f.get("invoice_id"));
  const { error } = await supabase.rpc("void_invoice", { p_invoice_id: id, p_reason: String(f.get("reason") ?? "") });
  if (error) return { error: friendlyError(error) };
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  revalidatePath("/");
  return { ok: "Invoice voided." };
}

/** lines: [{invoice_item_id, qty}]  refunds: [{method, amount}] (dollars as typed) */
export async function createCreditNote(_: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await requireStaff();
  const id = String(f.get("invoice_id"));
  try {
    const lines = (JSON.parse(String(f.get("lines") ?? "[]")) as { invoice_item_id: string; qty: number }[]).filter((l) => l.qty > 0);
    if (!lines.length) return { error: "Pick how many of which item is coming back." };
    const refunds = (JSON.parse(String(f.get("refunds") ?? "[]")) as { method: string; amount: string }[])
      .map((r) => ({ method: r.method, amount_cents: requireCents(r.amount, "Refund") }))
      .filter((r) => r.amount_cents > 0);
    const { error } = await supabase.rpc("create_credit_note", {
      p_invoice_id: id,
      p_lines: lines,
      p_reason: String(f.get("reason") ?? ""),
      p_refunds: refunds,
      p_idempotency_key: String(f.get("idempotency_key")),
    });
    if (error) return { error: friendlyError(error) };
  } catch (e) {
    return { error: friendlyError(e) };
  }
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  revalidatePath("/");
  return { ok: "Credit note created." };
}
