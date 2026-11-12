"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { createTicket, searchCustomers, customerDevices, type CustomerHit, type PastDevice } from "@/app/(app)/tickets/actions";
import { DEVICE_TYPES, phonePretty } from "@/lib/format";
import { ui } from "@/lib/ui";

const BRANDS: Record<string, string[]> = {
  Phone: ["Apple", "Samsung", "Google", "Motorola", "OnePlus", "LG"],
  Tablet: ["Apple", "Samsung", "Lenovo", "Microsoft", "Amazon"],
  Laptop: ["Apple", "HP", "Dell", "Lenovo", "Asus", "Acer", "Microsoft"],
  Desktop: ["Apple", "HP", "Dell", "Lenovo", "Custom build"],
  Console: ["Sony", "Microsoft", "Nintendo"],
  Watch: ["Apple", "Samsung", "Garmin", "Fitbit"],
  Drone: ["DJI"],
  Printer: ["HP", "Brother", "Canon", "Epson"],
  Other: [],
};

const PROBLEMS: Record<string, string[]> = {
  Phone: ["Screen", "Battery", "Charging port", "Back glass", "Camera", "Water damage", "No power", "Speaker / mic", "Software / data", "Diagnosis"],
  Tablet: ["Screen", "Battery", "Charging port", "No power", "Water damage", "Software / data", "Diagnosis"],
  Laptop: ["Screen", "Battery", "Keyboard", "Charging port", "No power", "Overheating", "Slow / virus", "Water damage", "Data recovery", "Diagnosis"],
  default: ["Not working", "No power", "Charging", "Water damage", "Diagnosis"],
};

type Tech = { id: string; full_name: string };

export default function CheckInForm({
  techs,
  initialCustomer,
  showError,
}: {
  techs: Tech[];
  initialCustomer: CustomerHit | null;
  showError: boolean;
}) {
  // Customer
  const [customer, setCustomer] = useState<CustomerHit | null>(initialCustomer);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [devices, setDevices] = useState<PastDevice[]>([]);
  const [, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  // Device
  const [deviceType, setDeviceType] = useState("Phone");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [imei, setImei] = useState("");
  const [color, setColor] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [problemText, setProblemText] = useState("");
  const [printLabel, setPrintLabel] = useState(true);
  const [saving, setSaving] = useState(false);

  // Remember the "print label" choice on this computer.
  useEffect(() => {
    try {
      const v = localStorage.getItem("tg.printLabel");
      if (v !== null) setPrintLabel(v === "1");
    } catch {}
  }, []);

  // Live search, 250 ms after typing stops.
  useEffect(() => {
    if (customer) return;
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setSearched(false);
      return;
    }
    const timer = setTimeout(() => {
      startTransition(async () => {
        const res = await searchCustomers(term);
        setHits(res);
        setSearched(true);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [q, customer]);

  // Past devices for the picked customer.
  useEffect(() => {
    setDevices([]);
    if (customer) customerDevices(customer.id).then(setDevices).catch(() => {});
  }, [customer]);

  const looksLikePhone = /^[\d\s()+-]{7,}$/.test(q.trim());
  const nameParts = !looksLikePhone ? q.trim().split(/\s+/) : [];

  const pickDevice = (d: PastDevice) => {
    setDeviceType(DEVICE_TYPES.includes(d.device_type) ? d.device_type : "Other");
    setBrand(d.brand ?? "");
    setModel(d.model ?? "");
    setImei(d.imei_serial ?? "");
    setColor(d.color ?? "");
  };

  const toggleProblem = (p: string) => setProblems((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const problem = [...problems, problemText.trim()].filter(Boolean).join(", ");
  const brandChoices = BRANDS[deviceType] ?? [];
  const problemChoices = PROBLEMS[deviceType] ?? PROBLEMS.default;

  return (
    <form
      action={createTicket}
      onSubmit={() => setSaving(true)}
      className="space-y-4"
      onKeyDown={(e) => {
        // Enter in the search box picks the first match instead of submitting.
        if (e.key === "Enter" && e.target === searchRef.current) {
          e.preventDefault();
          if (hits[0]) setCustomer(hits[0]);
        }
      }}
    >
      <input type="hidden" name="customer_id" value={customer?.id ?? ""} />
      <input type="hidden" name="device_type" value={deviceType} />
      <input type="hidden" name="problem" value={problem} />

      {/* 1. Customer */}
      <section className={ui.card}>
        <h2 className={`${ui.h2} mb-3`}>1. Customer</h2>
        {customer ? (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-brand-soft p-3">
            <div className="min-w-0">
              <p className="truncate font-semibold text-zinc-900">{customer.name}</p>
              <p className="truncate text-sm text-zinc-600">
                {phonePretty(customer.phone)} {customer.email ? `· ${customer.email}` : ""}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 text-sm text-zinc-600 hover:underline"
              onClick={() => {
                setCustomer(null);
                setTimeout(() => searchRef.current?.focus(), 0);
              }}
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Start typing a phone number or name"
              className={ui.input}
              autoFocus
              autoComplete="off"
              inputMode="search"
            />
            {hits.length > 0 && (
              <ul className="mt-2 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                {hits.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setCustomer(c)} className="flex w-full justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-brand-soft">
                      <span className="truncate font-medium">{c.name}</span>
                      <span className="shrink-0 text-zinc-500">{phonePretty(c.phone)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {searched && !hits.length && <p className="mt-2 text-sm text-zinc-500">No match. Fill in the new customer below.</p>}

            {(searched && !hits.length) || showError ? (
              <div className="mt-4 rounded-lg border border-dashed border-zinc-300 p-3">
                <p className="mb-2 text-sm font-semibold text-zinc-700">New customer</p>
                {showError && (
                  <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Pick a customer or enter at least a name or phone.</p>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="First name" name="first_name" defaultValue={nameParts[0] ?? ""} key={"f" + q} />
                  <Field label="Last name" name="last_name" defaultValue={nameParts.slice(1).join(" ")} key={"l" + q} />
                  <Field label="Phone" name="phone" type="tel" defaultValue={looksLikePhone ? q.trim() : ""} key={"p" + q} />
                  <Field label="Email (optional)" name="email" type="email" />
                </div>
              </div>
            ) : (
              !searched && <p className="mt-2 text-xs text-zinc-500">Type at least 2 characters. New customer? Type their number and the form appears.</p>
            )}
          </>
        )}
      </section>

      {/* 2. Device */}
      <section className={ui.card}>
        <h2 className={`${ui.h2} mb-3`}>2. Device</h2>
        {devices.length > 0 && (
          <div className="mb-4">
            <p className={ui.label}>Brought in before (tap to reuse)</p>
            <div className="flex flex-wrap gap-2">
              {devices.map((d, i) => (
                <button key={i} type="button" onClick={() => pickDevice(d)} className={chip(brand === d.brand && model === d.model)}>
                  {[d.brand, d.model].filter(Boolean).join(" ")}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {DEVICE_TYPES.map((d) => (
            <button key={d} type="button" onClick={() => setDeviceType(d)} className={chip(deviceType === d)}>
              {d}
            </button>
          ))}
        </div>
        {brandChoices.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {brandChoices.map((b) => (
              <button key={b} type="button" onClick={() => setBrand(b)} className={chip(brand === b, true)}>
                {b}
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Controlled label="Brand" name="brand" value={brand} onChange={setBrand} />
          <Controlled label="Model" name="model" value={model} onChange={setModel} placeholder="iPhone 14 Plus" />
          <Controlled label="IMEI / serial (optional)" name="imei_serial" value={imei} onChange={setImei} />
          <Controlled label="Colour (optional)" name="color" value={color} onChange={setColor} />
        </div>
      </section>

      {/* 3. Problem */}
      <section className={ui.card}>
        <h2 className={`${ui.h2} mb-3`}>3. Problem</h2>
        <div className="flex flex-wrap gap-2">
          {problemChoices.map((p) => (
            <button key={p} type="button" onClick={() => toggleProblem(p)} className={chip(problems.includes(p))}>
              {p}
            </button>
          ))}
        </div>
        <input
          value={problemText}
          onChange={(e) => setProblemText(e.target.value)}
          placeholder="Anything else? (optional)"
          className={`${ui.input} mt-3`}
        />
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-zinc-600">More: condition, accessories</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={ui.label}>Condition on arrival</label>
              <textarea name="condition_notes" rows={2} className={ui.input} placeholder="Scratches on back, cracked corner…" />
            </div>
            <Field label="Left with us" name="accessories" placeholder="Case, charger, SIM…" />
          </div>
        </details>
      </section>

      {/* 4. Price */}
      <section className={ui.card}>
        <h2 className={`${ui.h2} mb-3`}>4. Price and technician</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Estimate ($, before tax)" name="estimate" inputMode="decimal" />
          <Field label="Deposit paid ($)" name="deposit" inputMode="decimal" />
          <div>
            <label className={ui.label}>Technician</label>
            <select name="technician_id" className={ui.input} defaultValue="">
              <option value="">Not assigned</option>
              {techs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 text-sm text-zinc-700 sm:flex-row sm:gap-6">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="send_text" defaultChecked className="h-4 w-4 accent-brand" />
            Text the customer a check-in confirmation
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="print_label"
              checked={printLabel}
              onChange={(e) => {
                setPrintLabel(e.target.checked);
                try {
                  localStorage.setItem("tg.printLabel", e.target.checked ? "1" : "0");
                } catch {}
              }}
              className="h-4 w-4 accent-brand"
            />
            Print the label right away
          </label>
        </div>
      </section>

      <div className="sticky bottom-20 z-10 flex items-center justify-end gap-2 rounded-xl border border-zinc-200 bg-white/95 p-3 shadow-sm backdrop-blur md:bottom-4">
        <p className="mr-auto hidden truncate text-sm text-zinc-500 sm:block">
          {customer?.name ?? "New customer"} · {[brand, model].filter(Boolean).join(" ") || deviceType} · {problem || "no problem picked yet"}
        </p>
        <Link href="/tickets" className={ui.btnGhost}>
          Cancel
        </Link>
        <button className={ui.btn} disabled={saving || !problem}>
          {saving ? "Saving…" : "Create ticket"}
        </button>
      </div>
    </form>
  );
}

function chip(active: boolean, small = false) {
  return `rounded-full border px-3 ${small ? "py-1 text-xs" : "py-1.5 text-sm"} font-medium transition ${
    active ? "border-brand bg-brand text-white" : "border-zinc-300 bg-white text-zinc-700 hover:border-brand"
  }`;
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

function Controlled({ label, name, value, onChange, placeholder }: { label: string; name: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className={ui.label} htmlFor={name}>
        {label}
      </label>
      <input id={name} name={name} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={ui.input} />
    </div>
  );
}
