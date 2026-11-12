"use client";

import { useMemo, useState } from "react";
import { money, PAYMENT_METHODS } from "@/lib/format";
import { ui } from "@/lib/ui";

type Line = { description: string; qty: number; unit_price: number; unit_cost?: number; taxable: boolean; imei_serial?: string };

export default function InvoiceBuilder({
  action,
  initialLines,
  taxRate,
  taxName,
  deposit,
  customerId,
  ticketId,
}: {
  action: (f: FormData) => Promise<void>;
  initialLines: Line[];
  taxRate: number;
  taxName: string;
  deposit: number;
  customerId: string | null;
  ticketId: string | null;
}) {
  const [lines, setLines] = useState<Line[]>(initialLines.length ? initialLines : [{ description: "", qty: 1, unit_price: 0, taxable: true }]);
  const [discount, setDiscount] = useState(0);
  const [payAmount, setPayAmount] = useState<string>("");

  const t = useMemo(() => {
    const r = (n: number) => Math.round(n * 100) / 100;
    const subtotal = r(lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0));
    const d = r(Math.min(Math.max(discount || 0, 0), subtotal));
    const taxable = lines.filter((l) => l.taxable).reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);
    const tax = r((subtotal > 0 ? taxable - d * (taxable / subtotal) : 0) * taxRate);
    const total = r(subtotal - d + tax);
    return { subtotal, discount: d, tax, total, due: r(total - deposit) };
  }, [lines, discount, taxRate, deposit]);

  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <input type="hidden" name="customer_id" value={customerId ?? ""} />
      <input type="hidden" name="ticket_id" value={ticketId ?? ""} />
      <input type="hidden" name="deposit" value={deposit} />
      <input type="hidden" name="discount" value={discount} />

      <section className={ui.card}>
        <h2 className={`${ui.h2} mb-3`}>Items</h2>
        <div className="space-y-3">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 items-end gap-2 border-b border-zinc-100 pb-3">
              <div className="col-span-12 sm:col-span-4">
                <label className={ui.label}>Description</label>
                <input value={l.description} onChange={(e) => update(i, { description: e.target.value })} className={ui.input} placeholder="iPhone 14 Plus LCD replacement" />
              </div>
              <div className="col-span-6 sm:col-span-2">
                <label className={ui.label}>IMEI (optional)</label>
                <input value={l.imei_serial ?? ""} onChange={(e) => update(i, { imei_serial: e.target.value })} className={ui.input} />
              </div>
              <div className="col-span-3 sm:col-span-1">
                <label className={ui.label}>Qty</label>
                <input type="number" min={1} value={l.qty} onChange={(e) => update(i, { qty: Number(e.target.value) })} className={ui.input} />
              </div>
              <div className="col-span-3 sm:col-span-2">
                <label className={ui.label}>Price ($)</label>
                <input type="number" step="0.01" value={l.unit_price} onChange={(e) => update(i, { unit_price: Number(e.target.value) })} className={ui.input} />
              </div>
              <div className="col-span-6 sm:col-span-2">
                <label className={ui.label} title="What the part cost us. Used for profit; never printed.">Part cost ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={l.unit_cost ?? ""}
                  onChange={(e) => update(i, { unit_cost: e.target.value === "" ? undefined : Number(e.target.value) })}
                  className={ui.input}
                  placeholder="optional"
                />
              </div>
              <div className="col-span-6 flex flex-col items-end gap-1 pb-1 sm:col-span-1">
                <label className="flex items-center gap-1 text-xs text-zinc-600">
                  <input type="checkbox" checked={l.taxable} onChange={(e) => update(i, { taxable: e.target.checked })} className="accent-brand" />
                  {taxName}
                </label>
                <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-xs text-red-600 hover:underline">
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setLines((ls) => [...ls, { description: "", qty: 1, unit_price: 0, taxable: true }])} className={`${ui.btnGhost} mt-3`}>
          + Add item
        </button>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <section className={ui.card}>
          <h2 className={`${ui.h2} mb-3`}>Payment now</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={ui.label}>Method</label>
              <select name="pay_method" className={ui.input} defaultValue="debit">
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={ui.label}>Amount ($)</label>
              <input name="pay_amount" type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className={ui.input} placeholder="0.00" />
            </div>
          </div>
          <button type="button" onClick={() => setPayAmount(String(Math.max(t.due, 0).toFixed(2)))} className="mt-2 text-sm text-brand-dark hover:underline">
            Customer pays the full {money(Math.max(t.due, 0))}
          </button>
          <div className="mt-3">
            <label className={ui.label}>Invoice note (printed)</label>
            <input name="notes" className={ui.input} placeholder="Key functions tested." />
          </div>
        </section>

        <section className={`${ui.card} space-y-2 text-sm`}>
          <Row k="Subtotal" v={money(t.subtotal)} />
          <div className="flex items-center justify-between">
            <span className="text-zinc-600">Discount ($)</span>
            <input type="number" step="0.01" value={discount || ""} onChange={(e) => setDiscount(Number(e.target.value))} className="w-28 rounded-md border border-zinc-300 px-2 py-1 text-right" placeholder="0.00" />
          </div>
          <Row k={`${taxName} ${(taxRate * 100).toFixed(0)}%`} v={money(t.tax)} />
          <div className="flex justify-between border-t border-zinc-200 pt-2 text-base font-bold">
            <span>Total</span>
            <span>{money(t.total)}</span>
          </div>
          {deposit > 0 && <Row k="Deposit already paid" v={`− ${money(deposit)}`} />}
          <div className="flex justify-between text-base font-semibold text-brand-dark">
            <span>Due</span>
            <span>{money(t.due - (Number(payAmount) || 0))}</span>
          </div>
          <button className={`${ui.btn} mt-3 w-full`}>Save invoice</button>
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
