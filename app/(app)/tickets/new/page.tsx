import Link from "next/link";
import { requireStaff } from "@/lib/session";
import { DEVICE_TYPES, cleanSearch, fullName, phonePretty } from "@/lib/format";
import { ui } from "@/lib/ui";
import { createTicket } from "../actions";

export const dynamic = "force-dynamic";

const COMMON_PROBLEMS = [
  "Screen replacement",
  "LCD replacement",
  "Battery replacement",
  "Charging port",
  "Not charging",
  "Back glass",
  "Camera",
  "Water damage",
  "No power",
  "Diagnosis",
  "Software / data transfer",
  "Overheating",
  "Keyboard",
  "Speaker / microphone",
];

export default async function NewTicket({ searchParams }: { searchParams: Promise<{ q?: string; customer?: string; error?: string }> }) {
  const { q, customer, error } = await searchParams;
  const { supabase } = await requireStaff();

  let selected: any = null;
  if (customer) {
    const { data } = await supabase.from("customers").select("id, first_name, last_name, company, phone, email").eq("id", customer).single();
    selected = data;
  }

  let results: any[] = [];
  const term = cleanSearch(q ?? "");
  if (!selected && term) {
    const digits = term.replace(/\D/g, "");
    const filters = [`first_name.ilike.%${term}%`, `last_name.ilike.%${term}%`, `company.ilike.%${term}%`];
    if (digits.length >= 3) filters.push(`phone.ilike.%${digits}%`);
    const { data } = await supabase
      .from("customers")
      .select("id, first_name, last_name, company, phone, email")
      .eq("archived", false)
      .or(filters.join(","))
      .limit(15);
    results = data ?? [];
  }

  const { data: techs } = await supabase.from("staff").select("id, full_name").eq("active", true).order("full_name");

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className={ui.h1}>New repair ticket</h1>

      {/* Step 1: customer */}
      <section className={ui.card}>
        <h2 className={`${ui.h2} mb-3`}>1. Customer</h2>
        {selected ? (
          <div className="flex items-center justify-between rounded-lg bg-brand-soft p-3">
            <div>
              <p className="font-semibold text-zinc-900">{fullName(selected)}</p>
              <p className="text-sm text-zinc-600">
                {phonePretty(selected.phone)} {selected.email ? `· ${selected.email}` : ""}
              </p>
            </div>
            <Link href="/tickets/new" className="text-sm text-zinc-600 hover:underline">
              Change
            </Link>
          </div>
        ) : (
          <>
            <form className="flex gap-2">
              <input name="q" defaultValue={q ?? ""} placeholder="Type phone number or name" className={ui.input} autoFocus />
              <button className={ui.btnGhost}>Find</button>
            </form>
            {term && (
              <ul className="mt-3 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                {results.map((c) => (
                  <li key={c.id}>
                    <Link href={`/tickets/new?customer=${c.id}`} className="flex justify-between px-3 py-2 text-sm hover:bg-zinc-50">
                      <span className="font-medium">{fullName(c)}</span>
                      <span className="text-zinc-500">{phonePretty(c.phone)}</span>
                    </Link>
                  </li>
                ))}
                {!results.length && <li className="px-3 py-2 text-sm text-zinc-500">No match. Add them as a new customer below.</li>}
              </ul>
            )}
          </>
        )}
      </section>

      {/* Step 2: device and problem */}
      <form action={createTicket} className="space-y-5">
        <input type="hidden" name="customer_id" value={selected?.id ?? ""} />

        {!selected && (
          <section className={ui.card}>
            <h2 className={`${ui.h2} mb-3`}>New customer</h2>
            {error === "customer" && (
              <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Pick a customer or enter at least a name or phone.</p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="First name" name="first_name" />
              <Field label="Last name" name="last_name" />
              <Field label="Phone" name="phone" type="tel" defaultValue={/^\+?[\d\s()-]{7,}$/.test(q ?? "") ? q : ""} />
              <Field label="Email (optional)" name="email" type="email" />
            </div>
          </section>
        )}

        <section className={ui.card}>
          <h2 className={`${ui.h2} mb-3`}>2. Device and problem</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={ui.label}>Device type</label>
              <select name="device_type" className={ui.input} defaultValue="Phone">
                {DEVICE_TYPES.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </div>
            <Field label="Brand" name="brand" placeholder="Apple, Samsung…" />
            <Field label="Model" name="model" placeholder="iPhone 14 Plus" />
            <Field label="IMEI / serial" name="imei_serial" />
            <Field label="Colour" name="color" />
            <Field label="Left with us" name="accessories" placeholder="Case, charger, SIM…" />
          </div>
          <div className="mt-3">
            <label className={ui.label}>Problem</label>
            <input name="problem" list="problems" required className={ui.input} placeholder="Screen replacement" />
            <datalist id="problems">
              {COMMON_PROBLEMS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div className="mt-3">
            <label className={ui.label}>Condition on arrival</label>
            <textarea name="condition_notes" rows={2} className={ui.input} placeholder="Scratches on back, cracked corner…" />
          </div>
        </section>

        <section className={ui.card}>
          <h2 className={`${ui.h2} mb-3`}>3. Price and technician</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Estimate ($, before tax)" name="estimate" inputMode="decimal" />
            <Field label="Deposit paid ($)" name="deposit" inputMode="decimal" />
            <div>
              <label className={ui.label}>Technician</label>
              <select name="technician_id" className={ui.input} defaultValue="">
                <option value="">Not assigned</option>
                {(techs ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" name="send_text" defaultChecked className="h-4 w-4 accent-brand" />
            Text the customer a check-in confirmation
          </label>
        </section>

        <div className="flex justify-end gap-2">
          <Link href="/tickets" className={ui.btnGhost}>
            Cancel
          </Link>
          <button className={ui.btn}>Create ticket</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, name, ...rest }: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className={ui.label} htmlFor={name}>
        {label}
      </label>
      <input id={name} name={name} className={ui.input} {...rest} />
    </div>
  );
}
