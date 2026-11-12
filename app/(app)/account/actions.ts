"use server";

import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/session";

export async function changePassword(f: FormData) {
  const { supabase, user } = await requireStaff();
  const current = String(f.get("current") ?? "");
  const next = String(f.get("next") ?? "");
  const confirm = String(f.get("confirm") ?? "");

  if (next.length < 10) redirect("/account?error=short");
  if (next !== confirm) redirect("/account?error=match");
  if (next === current) redirect("/account?error=same");

  // Prove it's really them: the current password must still work.
  const { error: wrong } = await supabase.auth.signInWithPassword({ email: user.email!, password: current });
  if (wrong) redirect("/account?error=current");

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) redirect("/account?error=" + (error.code === "weak_password" ? "weak" : "failed"));
  redirect("/account?saved=1");
}
