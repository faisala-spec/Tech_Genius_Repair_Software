"use client";

import { useActionState, useState } from "react";
import { takeDeposit, refundDeposit } from "@/app/(app)/tickets/actions";
import { PAYMENT_METHODS } from "@/lib/format";
import { ui } from "@/lib/ui";

function Msg({ state }: { state: { error?: string; ok?: string } | undefined }) {
  if (state?.error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>;
  if (state?.ok) return <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{state.ok}</p>;
  return null;
}

function MethodSelect() {
  return (
    <select name="method" defaultValue="debit" className={ui.input} aria-label="Paid by">
      {PAYMENT_METHODS.map((m) => (
        <option key={m.key} value={m.key}>
          {m.label}
        </option>
      ))}
    </select>
  );
}

export function TakeDepositForm({ ticketId }: { ticketId: string }) {
  const [state, action, pending] = useActionState(takeDeposit, undefined);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-brand-dark hover:underline">
        + Take a deposit
      </button>
    );
  return (
    <form
      action={async (f) => {
        await action(f);
        setKey(crypto.randomUUID());
      }}
      className="space-y-2"
    >
      <input type="hidden" name="ticket_id" value={ticketId} />
      <input type="hidden" name="idempotency_key" value={key} />
      <div className="grid grid-cols-2 gap-2">
        <MethodSelect />
        <input name="amount" inputMode="decimal" placeholder="0.00" className={`${ui.input} text-right`} aria-label="Amount" />
      </div>
      <button className={`${ui.btnGhost} w-full`} disabled={pending}>
        {pending ? "Saving…" : "Record deposit"}
      </button>
      <Msg state={state} />
    </form>
  );
}

export function RefundDepositForm({ ticketId }: { ticketId: string }) {
  const [state, action, pending] = useActionState(refundDeposit, undefined);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-zinc-500 hover:underline">
        Give deposit back
      </button>
    );
  return (
    <form
      action={async (f) => {
        await action(f);
        setKey(crypto.randomUUID());
      }}
      className="space-y-2 rounded-lg border border-zinc-200 p-3"
    >
      <input type="hidden" name="ticket_id" value={ticketId} />
      <input type="hidden" name="idempotency_key" value={key} />
      <div className="grid grid-cols-2 gap-2">
        <MethodSelect />
        <input name="amount" inputMode="decimal" placeholder="0.00" className={`${ui.input} text-right`} aria-label="Amount" />
      </div>
      <input name="reason" required placeholder="Reason, e.g. customer cancelled" className={ui.input} />
      <button className={`${ui.btnGhost} w-full`} disabled={pending}>
        {pending ? "Saving…" : "Refund deposit"}
      </button>
      <Msg state={state} />
    </form>
  );
}
