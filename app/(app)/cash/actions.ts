"use server";

// Cash drawer: open with a count, close with a count, move cash in/out (db/009_expenses_cash.sql).
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/session";
import { requireCents } from "@/lib/money";
import { cents } from "@/lib/money";
import { friendlyError } from "@/lib/format";

export type CashState = { error?: string; ok?: string; result?: { expected_cents: number; counted_cents: number; over_short_cents?: number; difference_cents?: number; starting_float?: boolean } } | undefined;

export async function openDrawer(_: CashState, f: FormData): Promise<CashState> {
  const { supabase } = await requireStaff();
  try {
    const { data, error } = await supabase.rpc("open_cash_session", { p_counted_cents: requireCents(f.get("counted") as string, "Count") });
    if (error) return { error: friendlyError(error) };
    revalidatePath("/cash");
    revalidatePath("/");
    const r = data as any;
    return { ok: r.starting_float ? `Drawer opened with a ${cents(r.counted_cents)} starting float.` : "Drawer opened.", result: r };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

export async function closeDrawer(_: CashState, f: FormData): Promise<CashState> {
  const { supabase } = await requireStaff();
  try {
    const { data, error } = await supabase.rpc("close_cash_session", {
      p_counted_cents: requireCents(f.get("counted") as string, "Count"),
      p_note: (f.get("note") as string) || null,
    });
    if (error) return { error: friendlyError(error) };
    revalidatePath("/cash");
    revalidatePath("/");
    return { ok: "Drawer closed.", result: data as any };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

export async function moveCash(_: CashState, f: FormData): Promise<CashState> {
  const { supabase } = await requireStaff();
  try {
    const amount = requireCents(f.get("amount") as string, "Amount");
    const { error } = await supabase.rpc("cash_movement", { p_kind: String(f.get("kind")), p_amount_cents: amount, p_note: (f.get("note") as string) || null });
    if (error) return { error: friendlyError(error) };
    revalidatePath("/cash");
    return { ok: `Recorded ${cents(amount)}.` };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}
