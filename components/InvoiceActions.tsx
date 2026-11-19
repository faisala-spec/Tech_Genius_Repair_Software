"use client";

import { useActionState, useState } from "react";
import { addPayment, createCreditNote, voidInvoice } from "@/app/(app)/invoices/actions";
import { PAYMENT_METHODS } from "@/lib/format";
import { cents, centsToInput, roundNickel, toCents } from "@/lib/money";
import { ui } from "@/lib/ui";

function Msg({ state }: { state: { error?: string; ok?: string } | undefined }) {
  if (state?.error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>;
  if (state?.ok) return <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{state.ok}</p>;
  return null;
}

/** Receive a payment. Cash suggests the balance rounded to the nearest 5¢. */
export function PaymentForm({ invoiceId, balanceCents }: { invoiceId: string; balanceCents: number }) {
  const [state, action, pending] = useActionState(addPayment, undefined);
  const [method, setMethod] = useState("debit");
  const [amount, setAmount] = useState(centsToInput(balanceCents));
  const [key, setKey] = useState(() => crypto.randomUUID());
  return (
    <form
      action={async (f) => {
        await action(f);
        setKey(crypto.randomUUID()); // next payment gets a new key; a double-click on this one doesn't
      }}
      className="space-y-2"
    >
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <input type="hidden" name="idempotency_key" value={key} />
      <div className="grid grid-cols-2 gap-2">
        <select
          name="method"
          value={method}
          onChange={(e) => {
            setMethod(e.target.value);
            setAmount(centsToInput(e.target.value === "cash" ? roundNickel(balanceCents) : balanceCents));
          }}
          className={ui.input}
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        <input name="amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={`${ui.input} text-right`} />
      </div>
      <input name="reference" className={ui.input} placeholder="Terminal ref / last 4 (optional, never the card number)" maxLength={40} />
      <button className={`${ui.btn} w-full`} disabled={pending}>
        {pending ? "Saving…" : `Receive ${cents(toCents(amount) ?? 0)}`}
      </button>
      <Msg state={state} />
    </form>
  );
}

export function VoidForm({ invoiceId }: { invoiceId: string }) {
  const [state, action, pending] = useActionState(voidInvoice, undefined);
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={ui.btnDanger}>
        Void invoice
      </button>
    );
  return (
    <form action={action} className="space-y-2 rounded-lg border border-red-200 bg-red-50/40 p-3">
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <p className="text-sm text-zinc-700">Voiding cancels an invoice nobody has paid. It keeps its number. Paid invoices need a credit note instead.</p>
      <input name="reason" required className={ui.input} placeholder="Why? e.g. typed the wrong price" />
      <div className="flex gap-2">
        <button className={ui.btnDanger} disabled={pending}>
          {pending ? "Voiding…" : "Void it"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={ui.btnGhost}>
          Cancel
        </button>
      </div>
      <Msg state={state} />
    </form>
  );
}

type Item = { id: string; line_no: number; description: string; qty: number; credited_qty: number; net_cents: number; tax_cents: number };

/** Return / credit: pick quantities per line, then refund money if the customer paid more than they now owe. */
export function CreditNoteForm({ invoiceId, items, paidCents, balanceCents }: { invoiceId: string; items: Item[]; paidCents: number; balanceCents: number }) {
  const [state, action, pending] = useActionState(createCreditNote, undefined);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [refund, setRefund] = useState({ method: "debit", amount: "" });
  const [key, setKey] = useState(() => crypto.randomUUID());
  const available = items.filter((i) => i.qty - i.credited_qty > 0);
  // Estimate only (the database works out the exact credit): net + tax per unit.
  const estimate = available.reduce((a, i) => a + Math.floor(((i.net_cents + i.tax_cents) * (qty[i.id] ?? 0)) / i.qty), 0);
  // They're owed back whatever the credit is beyond what they still owed (never more than they paid).
  const mustRefund = Math.min(paidCents, Math.max(0, estimate - balanceCents));

  if (!available.length) return null;
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={ui.btnGhost}>
        Return / credit note
      </button>
    );
  return (
    <form
      action={async (f) => {
        await action(f);
        setKey(crypto.randomUUID());
      }}
      className="space-y-3 rounded-lg border border-zinc-200 p-3"
    >
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <input type="hidden" name="idempotency_key" value={key} />
      <input type="hidden" name="lines" value={JSON.stringify(Object.entries(qty).map(([invoice_item_id, q]) => ({ invoice_item_id, qty: q })))} />
      <input type="hidden" name="refunds" value={JSON.stringify(refund.amount ? [refund] : [])} />
      <p className={ui.h2}>What's coming back?</p>
      <ul className="space-y-2 text-sm">
        {available.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate">{i.description}</span>
            <select value={qty[i.id] ?? 0} onChange={(e) => setQty((q) => ({ ...q, [i.id]: Number(e.target.value) }))} className="rounded-md border border-zinc-300 bg-surface px-2 py-1">
              {Array.from({ length: i.qty - i.credited_qty + 1 }, (_, n) => (
                <option key={n} value={n}>
                  {n} of {i.qty - i.credited_qty}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      <input name="reason" required className={ui.input} placeholder="Reason, e.g. customer returned the case" />
      <div>
        <p className="mb-1 text-sm text-zinc-700">
          Money back to the customer {mustRefund > 0 && <span className="font-semibold">(about {cents(mustRefund)} needed)</span>}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <select value={refund.method} onChange={(e) => setRefund((r) => ({ ...r, method: e.target.value }))} className={ui.input}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          <input value={refund.amount} onChange={(e) => setRefund((r) => ({ ...r, amount: e.target.value }))} inputMode="decimal" className={`${ui.input} text-right`} placeholder="0.00" />
        </div>
      </div>
      <div className="flex gap-2">
        <button className={ui.btn} disabled={pending || !Object.values(qty).some((n) => n > 0)}>
          {pending ? "Saving…" : "Create credit note"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={ui.btnGhost}>
          Cancel
        </button>
      </div>
      <Msg state={state} />
    </form>
  );
}
