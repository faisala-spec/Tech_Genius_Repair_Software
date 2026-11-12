"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff, canManage } from "@/lib/session";
import { PAYMENT_METHODS } from "@/lib/format";

type Line = { description: string; qty: number; unit_price: number; taxable: boolean; imei_serial?: string };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Totals are always worked out here on the server, never trusted from the browser. */
function totals(lines: Line[], discountIn: number, rate: number) {
  const subtotal = round2(lines.reduce((a, l) => a + l.qty * l.unit_price, 0));
  const discount = round2(Math.min(Math.max(discountIn, 0), subtotal));
  const taxableBase = lines.filter((l) => l.taxable).reduce((a, l) => a + l.qty * l.unit_price, 0);
  const taxableAfter = subtotal > 0 ? taxableBase - discount * (taxableBase / subtotal) : 0;
  const tax = round2(taxableAfter * rate);
  return { subtotal, discount, tax, total: round2(subtotal - discount + tax) };
}

function statusFor(paid: number, total: number) {
  if (paid >= total - 0.004) return "paid";
  if (paid > 0) return "partial";
  return "unpaid";
}

export async function createInvoice(f: FormData) {
  const { supabase, staff, shop } = await requireStaff();

  let lines: Line[] = [];
  try {
    lines = (JSON.parse(String(f.get("lines") ?? "[]")) as Line[])
      .map((l) => ({
        description: String(l.description ?? "").trim(),
        qty: Number(l.qty) || 0,
        unit_price: Number(l.unit_price) || 0,
        taxable: l.taxable !== false,
        imei_serial: l.imei_serial ? String(l.imei_serial).trim() : undefined,
      }))
      .filter((l) => l.description && l.qty > 0);
  } catch {
    lines = [];
  }
  if (!lines.length) throw new Error("Add at least one line to the invoice");

  const rate = Number(shop.tax_rate ?? 0.13);
  const t = totals(lines, Number(f.get("discount") ?? 0), rate);
  const ticketId = String(f.get("ticket_id") ?? "") || null;
  const customerId = String(f.get("customer_id") ?? "") || null;
  // Deposit comes from the ticket in the database (never from the browser),
  // and only counts on the first invoice for that ticket.
  let deposit = 0;
  if (ticketId) {
    const [{ data: tk }, { count: earlier }] = await Promise.all([
      supabase.from("tickets").select("deposit").eq("id", ticketId).single(),
      supabase.from("invoices").select("id", { count: "exact", head: true }).eq("ticket_id", ticketId).neq("status", "void"),
    ]);
    if (!earlier) deposit = round2(Number(tk?.deposit ?? 0));
  }
  const payNow = Number(f.get("pay_amount") ?? 0) || 0;
  const method = String(f.get("pay_method") ?? "debit");
  if (!PAYMENT_METHODS.some((m) => m.key === method)) throw new Error("Unknown payment method");

  const { data: number, error: numErr } = await supabase.rpc("next_number", { kind: "invoice" });
  if (numErr) throw new Error(numErr.message);

  const paid = round2(deposit + payNow);
  const { data: inv, error } = await supabase
    .from("invoices")
    .insert({
      number,
      customer_id: customerId,
      ticket_id: ticketId,
      subtotal: t.subtotal,
      discount: t.discount,
      tax: t.tax,
      total: t.total,
      paid,
      status: statusFor(paid, t.total),
      notes: String(f.get("notes") ?? "").trim() || null,
      created_by: staff.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { error: itemErr } = await supabase.from("invoice_items").insert(
    lines.map((l) => ({
      invoice_id: inv.id,
      description: l.description,
      imei_serial: l.imei_serial ?? null,
      qty: l.qty,
      unit_price: l.unit_price,
      taxable: l.taxable,
      line_total: round2(l.qty * l.unit_price),
    }))
  );
  if (itemErr) throw new Error(itemErr.message);

  const payments = [];
  if (deposit > 0) payments.push({ invoice_id: inv.id, method: "other", amount: deposit, reference: "Deposit taken at check-in", staff_id: staff.id });
  if (payNow > 0) payments.push({ invoice_id: inv.id, method, amount: payNow, staff_id: staff.id });
  if (payments.length) await supabase.from("payments").insert(payments);

  revalidatePath("/invoices");
  if (ticketId) revalidatePath(`/tickets/${ticketId}`);
  redirect(`/invoices/${inv.id}`);
}

export async function addPayment(f: FormData) {
  const { supabase, staff } = await requireStaff();
  const id = String(f.get("invoice_id"));
  const amount = round2(Number(f.get("amount") ?? 0));
  const method = String(f.get("method") ?? "debit");
  if (!amount) return;
  if (!PAYMENT_METHODS.some((m) => m.key === method)) throw new Error("Unknown payment method");

  const { data: inv } = await supabase.from("invoices").select("total, paid, status").eq("id", id).single();
  if (!inv || inv.status === "void") return;

  await supabase.from("payments").insert({ invoice_id: id, method, amount, reference: String(f.get("reference") ?? "") || null, staff_id: staff.id });
  const paid = round2(Number(inv.paid) + amount);
  await supabase.from("invoices").update({ paid, status: statusFor(paid, Number(inv.total)) }).eq("id", id);
  revalidatePath(`/invoices/${id}`);
}

export async function voidInvoice(f: FormData) {
  const { supabase, staff } = await requireStaff();
  if (!canManage(staff)) throw new Error("Only an owner or manager can void an invoice");
  const id = String(f.get("invoice_id"));
  await supabase.from("invoices").update({ status: "void", voided_at: new Date().toISOString() }).eq("id", id);
  await supabase.from("audit_log").insert({ staff_id: staff.id, action: "void_invoice", entity: "invoice", entity_id: id });
  revalidatePath(`/invoices/${id}`);
}
