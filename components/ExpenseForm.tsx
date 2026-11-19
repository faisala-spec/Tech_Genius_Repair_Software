"use client";

// Add expense. HST fills itself in as 13/113 of the total (what's inside a tax-included price);
// change it to match the receipt. "Claim back" is only offered where CRA allows it.
import { useActionState, useEffect, useState } from "react";
import { createExpense, voidExpense } from "@/app/(app)/expenses/actions";
import { cents, centsToInput, toCents } from "@/lib/money";
import { ui } from "@/lib/ui";

type Category = { id: string; name: string; itc_allowed: boolean; system_key: string | null };

const PAID_FROM = [
  { key: "bank", label: "Bank account (debit / transfer)" },
  { key: "credit_card", label: "Business credit card" },
  { key: "cash_drawer", label: "Cash from the drawer" },
  { key: "owner", label: "Owner paid personally" },
];

function Msg({ state }: { state: { error?: string; ok?: string } | undefined }) {
  if (state?.error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>;
  if (state?.ok) return <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{state.ok}</p>;
  return null;
}

export default function ExpenseForm({ categories, today, taxRate }: { categories: Category[]; today: string; taxRate: number }) {
  const [state, action, pending] = useActionState(createExpense, undefined);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [account, setAccount] = useState(categories[0]?.id ?? "");
  const [total, setTotal] = useState("");
  const [hst, setHst] = useState("");
  const [hstTouched, setHstTouched] = useState(false);
  const [claim, setClaim] = useState(true);
  const cat = categories.find((c) => c.id === account);
  const rateBp = Math.round(taxRate * 10000); // 0.13 → 1300

  // Tax inside a tax-included total: total × rate / (1 + rate), rounded to the cent.
  useEffect(() => {
    if (hstTouched) return;
    const t = toCents(total);
    setHst(t ? centsToInput(Math.floor((t * rateBp * 2 + (10000 + rateBp)) / ((10000 + rateBp) * 2))) : "");
  }, [total, hstTouched, rateBp]);

  const outsourced = cat?.system_key === "outsourced";
  const canClaim = !!cat?.itc_allowed && (toCents(hst) ?? 0) > 0;

  return (
    <form
      action={async (f) => {
        await action(f);
        setKey(crypto.randomUUID()); // the next expense gets a new key; a double-click on this one doesn't
      }}
      className="space-y-4"
    >
      <input type="hidden" name="idempotency_key" value={key} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Date on receipt">
          <input type="date" name="date" defaultValue={today} max={today} className={ui.input} required />
        </Field>
        <Field label="Paid to (vendor)">
          <input name="vendor" className={ui.input} placeholder="MobileSentrix, Landlord, Staples…" required />
        </Field>
        <Field label="Category">
          <select name="account_id" value={account} onChange={(e) => setAccount(e.target.value)} className={ui.input}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Paid from">
          <select name="paid_from" defaultValue="bank" className={ui.input}>
            {PAID_FROM.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Total paid ($, incl. tax)">
          <input name="total" value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" className={`${ui.input} text-right`} placeholder="0.00" required />
        </Field>
        <Field label="HST on the receipt ($)">
          <input
            name="hst"
            value={hst}
            onChange={(e) => {
              setHst(e.target.value);
              setHstTouched(true);
            }}
            inputMode="decimal"
            className={`${ui.input} text-right`}
            placeholder="0.00"
          />
        </Field>
        <div className="flex flex-col justify-end gap-1.5 pb-1 text-sm text-zinc-700">
          <label className={`flex items-center gap-2 ${canClaim ? "" : "opacity-50"}`} title={cat?.itc_allowed ? "" : "CRA doesn't allow claiming HST back on this category"}>
            <input type="checkbox" name="claim_itc" checked={canClaim && claim} disabled={!canClaim} onChange={(e) => setClaim(e.target.checked)} className="h-4 w-4 accent-brand" />
            Claim the HST back
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="has_receipt" defaultChecked className="h-4 w-4 accent-brand" />
            I have the receipt
          </label>
        </div>
        <Field label={outsourced ? "For ticket # (outsourced repair)" : "Ticket # (optional)"}>
          <input name="ticket_number" inputMode="numeric" className={ui.input} placeholder="1001" required={false} />
        </Field>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-medium text-zinc-600">More: vendor HST #, reference, note</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Vendor HST # (on receipts $30+)">
            <input name="vendor_hst_no" className={ui.input} />
          </Field>
          <Field label="Reference (invoice #, cheque #)">
            <input name="reference" className={ui.input} />
          </Field>
          <Field label="Note">
            <input name="note" className={ui.input} />
          </Field>
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-3">
        <button className={ui.btn} disabled={pending}>
          {pending ? "Saving…" : `Save expense${toCents(total) ? ` of ${cents(toCents(total))}` : ""}`}
        </button>
        {!cat?.itc_allowed && <span className="text-xs text-zinc-500">HST on {cat?.name} can't be claimed back, so it's counted as part of the cost.</span>}
      </div>
      <Msg state={state} />
    </form>
  );
}

export function VoidExpenseButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(voidExpense, undefined);
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-zinc-500 hover:text-red-700 hover:underline">
        Void
      </button>
    );
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="expense_id" value={id} />
      <input name="reason" required placeholder="Why?" className="w-36 rounded-md border border-zinc-300 bg-surface px-2 py-1 text-xs" />
      <button className="text-xs font-semibold text-red-700" disabled={pending}>
        Void
      </button>
      {state?.error && <span className="text-xs text-red-700">{state.error}</span>}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={ui.label}>{label}</label>
      {children}
    </div>
  );
}
