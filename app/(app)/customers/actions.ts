"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/session";
import { normalizePhone } from "@/lib/format";

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};

function fields(f: FormData) {
  return {
    first_name: str(f, "first_name"),
    last_name: str(f, "last_name"),
    company: str(f, "company"),
    phone: normalizePhone(str(f, "phone")) ?? str(f, "phone"),
    phone_alt: normalizePhone(str(f, "phone_alt")) ?? str(f, "phone_alt"),
    email: str(f, "email")?.toLowerCase() ?? null,
    address: str(f, "address"),
    city: str(f, "city"),
    postal_code: str(f, "postal_code")?.toUpperCase() ?? null,
    notes: str(f, "notes"),
    sms_consent: f.get("sms_consent") === "on",
  };
}

export async function createCustomer(f: FormData) {
  const { supabase } = await requireStaff();
  const { data, error } = await supabase.from("customers").insert(fields(f)).select("id").single();
  if (error) throw new Error(error.message);
  redirect(f.get("then") === "ticket" ? `/tickets/new?customer=${data.id}` : `/customers/${data.id}`);
}

export async function updateCustomer(f: FormData) {
  const { supabase } = await requireStaff();
  const id = String(f.get("id"));
  const { error } = await supabase.from("customers").update(fields(f)).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/customers/${id}`);
  redirect(`/customers/${id}`);
}
