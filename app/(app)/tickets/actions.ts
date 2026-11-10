"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/session";
import { normalizePhone, ticketLabel, deviceName, money, STATUSES } from "@/lib/format";
import { sendSms, smsTemplates } from "@/lib/sms";

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const num = (f: FormData, k: string) => {
  const v = str(f, k);
  return v === null ? null : Number(v.replace(/[^0-9.\-]/g, "")) || 0;
};

export async function createTicket(f: FormData) {
  const { supabase, staff, shop } = await requireStaff();

  // 1. Customer: picked from search, or created right here
  let customerId = str(f, "customer_id");
  if (!customerId) {
    const first = str(f, "first_name");
    const phone = normalizePhone(str(f, "phone"));
    if (!first && !phone) redirect("/tickets/new?error=customer");
    const { data: c, error } = await supabase
      .from("customers")
      .insert({
        first_name: first,
        last_name: str(f, "last_name"),
        phone,
        email: str(f, "email")?.toLowerCase() ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    customerId = c.id;
  }

  // 2. Ticket
  const { data: number, error: numErr } = await supabase.rpc("next_number", { kind: "ticket" });
  if (numErr) throw new Error(numErr.message);

  const { data: t, error } = await supabase
    .from("tickets")
    .insert({
      number,
      customer_id: customerId,
      device_type: str(f, "device_type") ?? "Phone",
      brand: str(f, "brand"),
      model: str(f, "model"),
      imei_serial: str(f, "imei_serial"),
      color: str(f, "color"),
      problem: str(f, "problem") ?? "Diagnosis",
      condition_notes: str(f, "condition_notes"),
      accessories: str(f, "accessories"),
      estimate: num(f, "estimate"),
      deposit: num(f, "deposit") ?? 0,
      created_by: staff.id,
      technician_id: str(f, "technician_id"),
    })
    .select("id, number, brand, model, device_type")
    .single();
  if (error) throw new Error(error.message);

  await supabase.from("ticket_events").insert({
    ticket_id: t.id,
    kind: "status_change",
    to_status: "received",
    body: "Ticket created",
    staff_id: staff.id,
  });

  // 3. Confirmation text
  if (f.get("send_text") === "on") {
    const { data: c } = await supabase.from("customers").select("first_name, phone, sms_consent").eq("id", customerId).single();
    if (c?.phone && c.sms_consent) {
      const body = smsTemplates.created(c.first_name ?? "there", deviceName(t), ticketLabel(shop.ticket_prefix, t.number), shop.name);
      await logText(supabase, customerId, t.id, c.phone, body, staff.id);
    }
  }

  revalidatePath("/tickets");
  redirect(`/tickets/${t.id}?new=1`);
}

export async function setStatus(f: FormData) {
  const { supabase, staff, shop } = await requireStaff();
  const id = String(f.get("ticket_id"));
  const to = String(f.get("status"));
  if (!STATUSES.some((s) => s.key === to)) throw new Error("Unknown status");

  const { data: t } = await supabase
    .from("tickets")
    .select("id, number, status, brand, model, device_type, estimate, deposit, customer_id, customers(first_name, phone, sms_consent)")
    .eq("id", id)
    .single();
  if (!t || t.status === to) return;

  const patch: Record<string, any> = { status: to };
  if (to === "picked_up") {
    patch.picked_up_at = new Date().toISOString();
    patch.passcode_enc = null; // passcodes never outlive the repair
    const w = new Date();
    w.setDate(w.getDate() + Number(shop.repair_warranty_days ?? 60));
    patch.warranty_until = w.toISOString().slice(0, 10);
  }
  const { error } = await supabase.from("tickets").update(patch).eq("id", id);
  if (error) throw new Error(error.message);

  await supabase.from("ticket_events").insert({
    ticket_id: id,
    kind: "status_change",
    from_status: t.status,
    to_status: to,
    staff_id: staff.id,
  });

  // "Ready" → text the customer automatically
  const c: any = t.customers;
  if (to === "ready" && c?.phone && c?.sms_consent) {
    const balance = Number(t.estimate ?? 0) - Number(t.deposit ?? 0);
    const body = smsTemplates.ready(
      c.first_name ?? "there",
      deviceName(t),
      ticketLabel(shop.ticket_prefix, t.number),
      shop.name,
      balance > 0 ? money(balance * (1 + Number(shop.tax_rate ?? 0.13))) : null
    );
    await logText(supabase, t.customer_id, id, c.phone, body, staff.id);
  }

  revalidatePath(`/tickets/${id}`);
  revalidatePath("/tickets");
  revalidatePath("/");
}

export async function addNote(f: FormData) {
  const { supabase, staff } = await requireStaff();
  const id = String(f.get("ticket_id"));
  const body = String(f.get("body") ?? "").trim();
  if (!body) return;
  await supabase.from("ticket_events").insert({ ticket_id: id, kind: "note", body, staff_id: staff.id });
  await supabase.from("tickets").update({ updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath(`/tickets/${id}`);
}

export async function textCustomer(f: FormData) {
  const { supabase, staff } = await requireStaff();
  const id = String(f.get("ticket_id"));
  const body = String(f.get("body") ?? "").trim();
  if (!body) return;
  const { data: t } = await supabase.from("tickets").select("customer_id, customers(phone)").eq("id", id).single();
  const phone = (t?.customers as any)?.phone;
  if (phone) await logText(supabase, t!.customer_id, id, phone, body, staff.id);
  revalidatePath(`/tickets/${id}`);
}

export async function updateTicket(f: FormData) {
  const { supabase } = await requireStaff();
  const id = String(f.get("ticket_id"));
  await supabase
    .from("tickets")
    .update({
      brand: str(f, "brand"),
      model: str(f, "model"),
      imei_serial: str(f, "imei_serial"),
      problem: str(f, "problem") ?? "Diagnosis",
      estimate: num(f, "estimate"),
      deposit: num(f, "deposit") ?? 0,
      technician_id: str(f, "technician_id"),
    })
    .eq("id", id);
  revalidatePath(`/tickets/${id}`);
}

async function logText(supabase: any, customerId: string, ticketId: string, to: string, body: string, staffId: string) {
  const res = await sendSms(to, body);
  await supabase.from("messages").insert({
    customer_id: customerId,
    ticket_id: ticketId,
    channel: "sms",
    direction: "out",
    body,
    status: res.ok ? "sent" : `not sent: ${res.error}`,
    provider_id: res.id ?? null,
    sent_by: staffId,
  });
  await supabase.from("ticket_events").insert({
    ticket_id: ticketId,
    kind: "sms_sent",
    body: res.ok ? `Text sent: ${body}` : `Text NOT sent (${res.error}): ${body}`,
    staff_id: staffId,
  });
}
