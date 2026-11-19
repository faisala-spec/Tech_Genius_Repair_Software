"use server";

// Owner settings. Shop details are a plain update (the database only lets the owner edit safe
// columns); everything about the books goes through checked database functions.
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/session";
import { friendlyError, normalizePhone } from "@/lib/format";

export type FormState = { error?: string; ok?: string } | undefined;
const s = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};

export async function updateShop(_: FormState, f: FormData): Promise<FormState> {
  const { supabase, shop } = await requireStaff();
  const rate = Number(s(f, "tax_rate_pct") ?? "13");
  if (!(rate >= 0 && rate < 100)) return { error: "Tax rate must be a percentage like 13." };
  const { error } = await supabase
    .from("shops")
    .update({
      name: s(f, "name") ?? shop.name,
      legal_name: s(f, "legal_name"),
      phone: normalizePhone(s(f, "phone")) ?? s(f, "phone"),
      email: s(f, "email"),
      address: s(f, "address"),
      city: s(f, "city"),
      province: s(f, "province"),
      tax_number: s(f, "tax_number"),
      tax_rate: Math.round(rate * 100) / 10000,
      repair_warranty_days: Number(s(f, "repair_warranty_days") ?? 60) || 60,
      device_warranty_days: Number(s(f, "device_warranty_days") ?? 90) || 90,
      invoice_terms: s(f, "invoice_terms"),
    })
    .eq("id", shop.id);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/", "layout");
  return { ok: "Saved. New invoices use these details." };
}

export async function addCategory(_: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await requireStaff();
  const { error } = await supabase.rpc("create_expense_category", { p_name: String(f.get("name") ?? ""), p_itc_allowed: f.get("itc_allowed") === "on" });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/settings");
  return { ok: "Category added." };
}

export async function updateAccount(_: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await requireStaff();
  const { error } = await supabase.rpc("update_account", {
    p_account_id: String(f.get("account_id")),
    p_name: String(f.get("name") ?? ""),
    p_active: f.get("active") === "on",
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/settings");
  return { ok: "Saved." };
}

export async function lockBooks(_: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await requireStaff();
  const { error } = await supabase.rpc("lock_books", { p_through: String(f.get("through") ?? "") || null });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/settings");
  return { ok: "Books locked." };
}

export async function unlockBooks(_: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await requireStaff();
  const { error } = await supabase.rpc("unlock_books", { p_through: String(f.get("through") ?? "") || null, p_reason: String(f.get("reason") ?? "") });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/settings");
  return { ok: "Books unlocked." };
}
