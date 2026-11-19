"use server";

// Expenses: one database function each (db/009_expenses_cash.sql). Owner/manager only.
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/session";
import { requireCents } from "@/lib/money";
import { friendlyError } from "@/lib/format";

export type FormState = { error?: string; ok?: string } | undefined;

export async function createExpense(_: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await requireStaff();
  try {
    let ticketId: string | null = null;
    const ticketNo = String(f.get("ticket_number") ?? "").replace(/\D/g, "");
    if (ticketNo) {
      const { data: t } = await supabase.from("tickets").select("id").eq("number", Number(ticketNo)).maybeSingle();
      if (!t) return { error: `There's no ticket ${ticketNo}.` };
      ticketId = t.id;
    }
    const total = requireCents(f.get("total") as string, "Total");
    const { error } = await supabase.rpc("create_expense", {
      p_date: String(f.get("date") ?? ""),
      p_vendor: String(f.get("vendor") ?? ""),
      p_account_id: String(f.get("account_id") ?? "") || null,
      p_total_cents: total,
      p_hst_cents: requireCents(f.get("hst") as string, "HST"),
      p_claim_itc: f.get("claim_itc") === "on",
      p_has_receipt: f.get("has_receipt") === "on",
      p_vendor_hst_no: (f.get("vendor_hst_no") as string) || null,
      p_paid_from: String(f.get("paid_from") ?? "bank"),
      p_ticket_id: ticketId,
      p_reference: (f.get("reference") as string) || null,
      p_note: (f.get("note") as string) || null,
      p_idempotency_key: String(f.get("idempotency_key")),
    });
    if (error) return { error: friendlyError(error) };
  } catch (e) {
    return { error: friendlyError(e) };
  }
  revalidatePath("/expenses");
  revalidatePath("/");
  return { ok: "Expense saved." };
}

export async function voidExpense(_: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await requireStaff();
  const { error } = await supabase.rpc("void_expense", { p_expense_id: String(f.get("expense_id")), p_reason: String(f.get("reason") ?? "") });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/expenses");
  revalidatePath("/");
  return { ok: "Expense voided." };
}
