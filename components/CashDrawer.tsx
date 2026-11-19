"use client";

// Drawer count by bills and coins (Canadian), so nobody adds up a pile of cash by hand.
import { useActionState, useState } from "react";
import { openDrawer, closeDrawer, moveCash, type CashState } from "@/app/(app)/cash/actions";
import { cents, centsToInput } from "@/lib/money";
import { ui } from "@/lib/ui";

const DENOMS = [
  { c: 10000, l: "$100" },
  { c: 5000, l: "$50" },
  { c: 2000, l: "$20" },
  { c: 1000, l: "$10" },
  { c: 500, l: "$5" },
  { c: 200, l: "$2" },
  { c: 100, l: "$1" },
  { c: 25, l: "25¢" },
  { c: 10, l: "10¢" },
  { c: 5, l: "5¢" },
];

function Msg({ state }: { state: CashState }) {
  if (state?.error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>;
  if (!state?.ok) return null;
  const r = state.result;
  const diff = r?.over_short_cents ?? (r && !r.starting_float ? r.difference_cents : undefined);
  return (
    <div className="space-y-1 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
      <p className="font-semibold">{state.ok}</p>
      {r && diff !== undefined && (
        <p className={diff === 0 ? "" : "font-semibold text-red-700"}>
          Expected {cents(r.expected_cents)} · counted {cents(r.counted_cents)} ·{" "}
          {diff === 0 ? "exactly right" : diff < 0 ? `${cents(-diff)} SHORT` : `${cents(diff)} over`}
        </p>
      )}
    </div>
  );
}

function Counter({ name }: { name: string }) {
  const [counts, setCounts] = useState<Record<number, string>>({});
  const total = DENOMS.reduce((a, d) => a + d.c * (Number(counts[d.c]) || 0), 0);
  return (
    <div>
      <div className="grid grid-cols-5 gap-2">
        {DENOMS.map((d) => (
          <label key={d.c} className="text-center">
            <span className="block text-xs font-semibold text-zinc-500">{d.l}</span>
            <input
              inputMode="numeric"
              value={counts[d.c] ?? ""}
              onChange={(e) => setCounts((c) => ({ ...c, [d.c]: e.target.value.replace(/\D/g, "") }))}
              className={`${ui.input} text-center`}
              placeholder="0"
              aria-label={`Number of ${d.l}`}
            />
          </label>
        ))}
      </div>
      <input type="hidden" name={name} value={centsToInput(total)} />
      <p className="mt-3 text-right text-lg font-bold">Counted: {cents(total)}</p>
    </div>
  );
}

export function OpenDrawerForm({ firstEver }: { firstEver: boolean }) {
  const [state, action, pending] = useActionState(openDrawer, undefined);
  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-zinc-600">
        {firstEver
          ? "First time: count the starting float you're putting in the drawer. It's recorded as the owner's money, not a sale."
          : "Count what's in the drawer before the first sale. Any difference from last night's close is recorded under your name."}
      </p>
      <Counter name="counted" />
      <button className={`${ui.btn} w-full`} disabled={pending}>
        {pending ? "Opening…" : "Open the drawer"}
      </button>
      <Msg state={state} />
    </form>
  );
}

export function CloseDrawerForm({ blind }: { blind: boolean }) {
  const [state, action, pending] = useActionState(closeDrawer, undefined);
  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-zinc-600">
        Count everything in the drawer. {blind ? "You won't see the expected amount until you've counted (that keeps counts honest)." : ""}
      </p>
      <Counter name="counted" />
      <input name="note" className={ui.input} placeholder="Note (optional), e.g. $20 given to delivery driver" />
      <button className={`${ui.btn} w-full`} disabled={pending}>
        {pending ? "Closing…" : "Close the drawer"}
      </button>
      <Msg state={state} />
    </form>
  );
}

export function MoveCashForm() {
  const [state, action, pending] = useActionState(moveCash, undefined);
  return (
    <form action={action} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select name="kind" className={ui.input} defaultValue="bank_deposit">
          <option value="bank_deposit">Take to the bank</option>
          <option value="owner_draw">Owner takes cash</option>
          <option value="float_from_bank">Add float from the bank</option>
          <option value="owner_contribution">Owner adds cash</option>
        </select>
        <input name="amount" inputMode="decimal" className={`${ui.input} text-right`} placeholder="0.00" aria-label="Amount" />
      </div>
      <input name="note" className={ui.input} placeholder="Note (optional)" />
      <button className={`${ui.btnGhost} w-full`} disabled={pending}>
        {pending ? "Saving…" : "Record"}
      </button>
      <Msg state={state} />
    </form>
  );
}
