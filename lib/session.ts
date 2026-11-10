import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export type Staff = { id: string; full_name: string; role: "owner" | "manager" | "technician" | "front_desk"; shop_id: string };
export type Shop = Record<string, any>;

/** Signed-in staff member + their shop. Redirects to login when there is none. */
export async function getContext() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: staff } = await supabase
    .from("staff")
    .select("id, full_name, role, shop_id")
    .eq("auth_user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!staff) return { supabase, user, staff: null as Staff | null, shop: null as Shop | null };

  const { data: shop } = await supabase.from("shops").select("*").eq("id", staff.shop_id).single();
  return { supabase, user, staff: staff as Staff, shop: shop as Shop };
}

export async function requireStaff() {
  const ctx = await getContext();
  if (!ctx.staff || !ctx.shop) redirect("/no-access");
  return ctx as { supabase: typeof ctx.supabase; user: typeof ctx.user; staff: Staff; shop: Shop };
}

export function canManage(staff: Staff) {
  return staff.role === "owner" || staff.role === "manager";
}
