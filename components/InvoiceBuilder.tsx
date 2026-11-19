"use client";

// New invoice / sale. Totals shown here come from the database (quote_invoice), the same maths
// that saves the invoice, so what you see is exactly what gets recorded.
import { useActionState, useEffect, useState } from "react";
import { createInvoice, quoteInvoice, type DraftLine, type Quote } from "@/app/(app)/invoices/actions";
import { LINE_CATEGORIES, PAYMENT_METHODS } from "@/lib/format";
import { cents, centsToInput, roundNickel, toCents } from "@/lib/money";
import { ui } from "@/lib/ui";

type Pay = { method: string; amount: string };

export default function InvoiceBuilder({
  initialLines,
  taxRate,
  taxName,
  depositCents,
  customerId,
  ticketId,
  showCost,
}: {
  initialLines: DraftLine[];
  taxRate: number;
  taxName: string;
  depositCents: number;
  customerId: string | null;
  ticketId: string | null;
  showCost: boolean;
}) {
  const blank = (): DraftLine => ({ description: "", category: ticketId ? "repair" : "accessory", qty: "1", price: "", cost: "", taxable: true, imei: "" });
  const [lines, setLines] = useState<DraftLine[]>(initialLines.length ? initialLines : [blank()]);
  const [discount, setDiscount] = useState("");
  const [pays, setPays] = useState<Pay[]>([{ method: "debit", amount: "" }]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(createInvoice, undefined);

  // Ask the database for totals 300 ms after typing stops.
  const draftKey = JSON.stringify([lines, discount]);
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await quoteInvoice(lines, discount);
      setQuote(r.quote ?? null);
      setQuoteError(r.error ?? null);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  const total = quote?.total_cents ?? 0;
  const depositUsed = Math.min(depositCents, total);
  const balance = total - depositUsed;
  const payingCents = pays.reduce((a, p) => a + (toCents(p.amount) ?? 0), 0);
  const left = balance - payingCents;
  const allCash = pays.length === 1 && pays[0].method === "cash";
  // Cash paying the balance rounded to the nickel settles it exactly.
  const shownLeft = allCash && balance > 0 && payingCents === roundNickel(balance) ? 0 : left;

  const update = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setPay = (i: number, patch: Partial<Pay>) => setPays((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const payFull = () => {
    const alreadyOthers = pays.slice(1).reduce((a, p) => a + (toCents(p.amount) ?? 0), 0);
    let amt = Math.max(balance - alreadyOthers, 0);
    if (pays[0].method === "cash") amt = roundNickel(amt);
    setPay(0, { amount: centsToInput(amt) });
  };

  const cols = showCost ? "sm:grid-cols-[1fr_8rem_4.5rem_7rem_7rem_auto]" : "sm:grid-cols-[1fr_8rem_4.5rem_7rem_auto]";

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <input type="hidden" name="payments" value={JSON.stringify(pays)} />
      <input type="hidden" name="customer_id" value={customerId ?? ""} />
      <input type="hidden" name="ticket_id" value={ticketId ?? ""} />
      <input type="hidden" name="discount" value={discount} />
      <input type="hidden" name="idempotency_key" value={key} />

      <section className={ui.card}>
        <h2 className={`${ui.h2} mb-3`}>Items</h2>
        <div className={`hidden gap-2 px-1 pb-1 sm:grid ${cols}`}>
          {["Description", "Type", "Qty", "Price ($)", ...(showCost ? ["Part cost ($)"] : []), ""].map((h) => (
            <span key={h} className={ui.label}>
              {h}
            </span>
          ))}
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className={`grid grid-cols-2 items-center gap-2 rounded-lg border border-zinc-100 p-2 sm:border-0 sm:p-0 ${cols}`}>
              <div className="col-span-2 sm:col-span-1">
                <input value={l.description} onChange={(e) => update(i, { description: e.target.value })} className={ui.input} placeholder="iPhone 14 screen replacement" />
                <input value={l.imei ?? ""} onChange={(e) => update(i, { imei: e.target.value })} className="mt-1 w-full bg-transparent px-1 text-xs text-zinc-500 outline-none placeholder:text-zinc-400" placeholder="+ IMEI / serial (optional)" />
              </div>
              <select value={l.category} onChange={(e) => update(i, { category: e.target.value })} className={ui.input} aria-label="Type">
                {LINE_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} inputMode="numeric" className={ui.input} aria-label="Quantity" />
              <input value={l.price} onChange={(e) => update(i, { price: e.target.value })} inputMode="decimal" className={`${ui.input} text-right`} placeholder="0.00" aria-label="Price" />
              {showCost && (
                <input
                  value={l.cost ?? ""}
                  onChange={(e) => update(i, { cost: e.target.value })}
                  inputMode="decimal"
                  className={`${ui.input} text-right`}
                  placeholder="optional"
                  aria-label="Part cost"
                  title="What the part cost us. Used for profit per repair; never printed."
                />
              )}
              <div className="flex items-center justify-end gap-3">
                <label className="flex items-center gap-1 text-xs text-zinc-600" title={`Charge ${taxName} on this line`}>
                  <input type="checkbox" checked={l.taxable} onChange={(e) => update(i, { taxable: e.target.checked })} className="accent-brand" />
                  {taxName}
                </label>
                <button type="button" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [blank()]))} className="text-lg leading-none text-zinc-400 hover:text-red-600" aria-label="Remove line">
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setLines((ls) => [...ls, blank()])} className={`${ui.btnGhost} mt-3`}>
          + Add item
        </button>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <section className={ui.card}>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className={ui.h2}>Payment now</h2>
            <span className="text-xs text-zinc-500">Leave blank to send it unpaid</span>
          </div>
          <div className="space-y-2">
            {pays.map((p, i) => (
              <div key={i} className="grid grid-cols-[1fr_8rem_auto] items-center gap-2">
                <select value={p.method} onChange={(e) => setPay(i, { method: e.target.value })} className={ui.input} aria-label="Method">
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <input value={p.amount} onChange={(e) => setPay(i, { amount: e.target.value })} inputMode="decimal" className={`${ui.input} text-right`} placeholder="0.00" aria-label="Amount" />
                {i > 0 ? (
                  <button type="button" onClick={() => setPays((ps) => ps.filter((_, j) => j !== i))} className="text-lg text-zinc-400 hover:text-red-600" aria-label="Remove payment">
                    ×
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <button type="button" onClick={payFull} disabled={balance <= 0} className="font-medium text-brand-dark hover:underline disabled:opacity-40">
              Pays the full {cents(pays[0].method === "cash" ? roundNickel(Math.max(balance, 0)) : Math.max(balance, 0))}
            </button>
            <button type="button" onClick={() => setPays((ps) => [...ps, { method: "credit", amount: "" }])} className="text-zinc-600 hover:underline">
              + Split payment
            </button>
          </div>
          {allCash && balance > 0 && <p className="mt-2 text-xs text-zinc-500">Cash rounds to the nearest 5¢ (no pennies). The drawer must be open.</p>}
          <div className="mt-4">
            <label className={ui.label} htmlFor="notes">
              Note on the invoice (printed)
            </label>
            <input id="notes" name="notes" className={ui.input} placeholder="e.g. Tested: Face ID, cameras, speakers" />
          </div>
        </section>

        <section className={`${ui.card} space-y-2 text-sm`}>
          <Row k="Subtotal" v={quote ? cents(quote.subtotal_cents) : "—"} />
          <div className="flex items-center justify-between">
            <span className="text-zinc-600">Discount ($)</span>
            <input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" className="w-28 rounded-md border border-zinc-300 bg-surface px-2 py-1 text-right" placeholder="0.00" aria-label="Discount" />
          </div>
          <Row k={`${taxName} ${(taxRate * 100).toFixed(0)}%`} v={quote ? cents(quote.tax_cents) : "—"} />
          <div className="flex justify-between border-t border-zinc-200 pt-2 text-base font-bold">
            <span>Total</span>
            <span>{quote ? cents(total) : "—"}</span>
          </div>
          {depositUsed > 0 && <Row k="Deposit already paid" v={`− ${cents(depositUsed)}`} />}
          {payingCents > 0 && <Row k="Paying now" v={`− ${cents(payingCents)}`} />}
          <div className={`flex justify-between text-base font-semibold ${shownLeft < 0 ? "text-red-700" : "text-brand-dark"}`}>
            <span>{shownLeft > 0 ? "Still owing" : shownLeft < 0 ? "More than the total" : "Balance"}</span>
            <span>{cents(shownLeft)}</span>
          </div>
          {quoteError && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{quoteError}</p>}
          {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{state.error}</p>}
          <button className={`${ui.btn} mt-2 w-full`} disabled={pending || !quote}>
            {pending ? "Saving…" : "Save invoice"}
          </button>
        </section>
      </div>
    </form>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-zinc-600">{k}</span>
      <span>{v}</span>
    </div>
  );
}
