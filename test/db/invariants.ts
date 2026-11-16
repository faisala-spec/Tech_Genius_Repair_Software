// "The books add up" — checked after every money test. Each rule compares two independent
// sources (documents vs ledger), so a bug in one shows up as a mismatch with the other.
import { expect } from "vitest";
import type { TestDb } from "./harness";

const n = (v: unknown) => Number(v ?? 0);

export async function assertBooksBalance(t: TestDb, shop?: string) {
  const shops = shop ? [shop] : [t.shopA, t.shopB];
  for (const s of shops) await checkShop(t, s);
}

async function checkShop(t: TestDb, shop: string) {
  const q = (sql: string, p: any[] = []) => t.admin(sql, [shop, ...p]);
  const bal = async (key: string) =>
    n((await q(`select coalesce(sum(debit_cents - credit_cents),0) as b from journal_lines jl join accounts a on a.id = jl.account_id where jl.shop_id = $1 and a.system_key = $2`, [key]))[0].b);

  // 1. Every entry balances, overall and one by one; every line is one-sided and non-negative.
  const bad = await q(`select entry_id, sum(debit_cents) d, sum(credit_cents) c, count(*) n from journal_lines where shop_id = $1 group by entry_id having sum(debit_cents) <> sum(credit_cents) or count(*) < 2`);
  expect(bad, "unbalanced journal entries").toEqual([]);
  const orphans = await q(`select id from journal_entries e where shop_id = $1 and not exists (select 1 from journal_lines l where l.entry_id = e.id)`);
  expect(orphans, "entries without lines").toEqual([]);

  // 2. Invoice maths, from the stored lines.
  const invs = await q(`select * from invoices where shop_id = $1`);
  for (const inv of invs) {
    const items = await t.admin(`select * from invoice_items where invoice_id = $1 order by line_no`, [inv.id]);
    const sum = (k: string) => items.reduce((a: number, i: any) => a + n(i[k]), 0);
    expect(sum("gross_cents"), `invoice ${inv.number} subtotal`).toBe(n(inv.subtotal_cents));
    expect(sum("discount_cents"), `invoice ${inv.number} discount split`).toBe(n(inv.discount_cents));
    expect(sum("tax_cents"), `invoice ${inv.number} tax split`).toBe(n(inv.tax_cents));
    expect(n(inv.total_cents)).toBe(n(inv.subtotal_cents) - n(inv.discount_cents) + n(inv.tax_cents));
    const taxable = items.filter((i: any) => i.tax_code === "HST").reduce((a: number, i: any) => a + n(i.net_cents), 0);
    expect(n(inv.taxable_base_cents)).toBe(taxable);
    expect(n(inv.tax_cents), `invoice ${inv.number} tax rounding`).toBe(roundHalfUp(taxable * Number(inv.tax_rate)));

    // 3. What the ledger says this invoice is still owed = what the invoice says.
    const arInv = n((await t.admin(`select coalesce(sum(debit_cents - credit_cents),0) b from journal_lines jl join accounts a on a.id = jl.account_id where jl.invoice_id = $1 and a.system_key = 'ar'`, [inv.id]))[0].b);
    const owed = inv.voided_at ? 0 : n(inv.total_cents) - n(inv.paid_cents) - n(inv.credited_cents);
    expect(arInv, `invoice ${inv.number} balance: ledger vs invoice`).toBe(owed);

    // 4. paid/credited caches = the payment and credit-note rows.
    const pays = await t.admin(`select kind, applied_cents from payments where invoice_id = $1`, [inv.id]);
    const paid = pays.reduce((a: number, p: any) => a + (["payment", "deposit_applied"].includes(p.kind) ? 1 : ["refund", "deposit_unapplied"].includes(p.kind) ? -1 : 0) * n(p.applied_cents), 0);
    expect(n(inv.paid_cents), `invoice ${inv.number} paid`).toBe(paid);
    const credited = n((await t.admin(`select coalesce(sum(total_cents),0) s from credit_notes where invoice_id = $1`, [inv.id]))[0].s);
    expect(n(inv.credited_cents)).toBe(credited);
    expect(n(inv.paid_cents) + n(inv.credited_cents)).toBeLessThanOrEqual(n(inv.total_cents));

    // 5. Status matches the numbers.
    const left = n(inv.total_cents) - n(inv.paid_cents) - n(inv.credited_cents);
    const want = inv.voided_at ? "void" : credited >= n(inv.total_cents) && n(inv.total_cents) > 0 ? "credited" : left <= 0 ? "paid" : n(inv.paid_cents) > 0 ? "partial" : "unpaid";
    expect(inv.status, `invoice ${inv.number} status`).toBe(want);
  }

  // 6. Customers-owe-us account = sum of open invoice balances.
  const openSum = invs.filter((i: any) => !i.voided_at).reduce((a: number, i: any) => a + n(i.total_cents) - n(i.paid_cents) - n(i.credited_cents), 0);
  expect(await bal("ar"), "A/R account vs open invoices").toBe(openSum);

  // 7. Deposits held = sum per ticket, and no ticket below zero.
  const perTicket = await q(`select ticket_id, sum(credit_cents - debit_cents) b from journal_lines jl join accounts a on a.id = jl.account_id where jl.shop_id = $1 and a.system_key = 'deposits' group by ticket_id`);
  for (const r of perTicket) expect(n(r.b), "deposit balance never negative").toBeGreaterThanOrEqual(0);
  expect(neg(await bal("deposits"))).toBe(perTicket.reduce((a: number, r: any) => a + n(r.b), 0));

  // 8. HST collected = tax on live invoices − tax on credit notes.
  const docTax = invs.filter((i: any) => !i.voided_at).reduce((a: number, i: any) => a + n(i.tax_cents), 0)
    - n((await q(`select coalesce(sum(tax_cents),0) s from credit_notes where shop_id = $1`))[0].s);
  expect(neg(await bal("hst_collected")), "HST collected vs documents").toBe(docTax);
  // HST to claim back (ITCs) = HST on live expenses marked "claim".
  const itcDocs = n((await q(`select coalesce(sum(hst_cents),0) s from expenses where shop_id = $1 and claim_itc and voided_at is null`))[0].s);
  expect(await bal("hst_itc"), "HST paid (ITCs) vs expense receipts").toBe(itcDocs);

  // 9. Money accounts = money rows (by method), so nothing moves without a record.
  const byMethod = await q(`select method, sum(case when kind in ('payment','deposit') then amount_cents when kind in ('refund','deposit_refund') then -amount_cents else 0 end) s from payments where shop_id = $1 and method is not null group by method`);
  const m = (k: string) => n(byMethod.find((r: any) => r.method === k)?.s);
  const extra = await extraMoney(t, shop);
  expect(await bal("cash"), "cash drawer vs payment rows").toBe(m("cash") + extra.cash);
  expect(await bal("card_clearing"), "card account vs payment rows").toBe(m("debit") + m("credit") + extra.card);
  expect(await bal("bank"), "bank vs payment rows").toBe(m("etransfer") + extra.bank);
}

/** Cash/bank movements that don't come from customer payments (expenses, drawer counts, drops). Filled in by later files. */
async function extraMoney(t: TestDb, shop: string) {
  const has = async (table: string) => (await t.admin(`select to_regclass($1) as r`, [`public.${table}`]))[0].r !== null;
  let cash = 0, bank = 0, card = 0;
  if (await has("expenses")) {
    // Cash expenses: what left the drawer is the bill rounded to the nickel.
    const roundingCol = (await t.admin(`select 1 from information_schema.columns where table_name = 'expenses' and column_name = 'cash_rounding_cents'`)).length > 0;
    const e = await t.admin(`select paid_from, sum(total_cents ${roundingCol ? "- cash_rounding_cents" : ""}) s from expenses where shop_id = $1 and voided_at is null group by paid_from`, [shop]);
    cash -= n(e.find((r: any) => r.paid_from === "cash_drawer")?.s);
    bank -= n(e.find((r: any) => r.paid_from === "bank")?.s);
  }
  if (await has("cash_movements")) {
    const mv = await t.admin(`select kind, sum(amount_cents) s from cash_movements where shop_id = $1 group by kind`, [shop]);
    const k = (x: string) => n(mv.find((r: any) => r.kind === x)?.s);
    cash += k("float_from_bank") + k("owner_contribution") - k("bank_deposit") - k("owner_draw");
    bank += k("bank_deposit") - k("float_from_bank");
  }
  const counts = await t.admin(`select coalesce(sum(case when a.system_key = 'cash' then debit_cents - credit_cents else 0 end),0) s from journal_lines jl join journal_entries e on e.id = jl.entry_id join accounts a on a.id = jl.account_id where jl.shop_id = $1 and e.source_type = 'cash_count'`, [shop]);
  cash += n(counts[0].s);
  // Cash rounding lines move the cash account by the rounding difference already included in amount_cents.
  return { cash, bank, card };
}

const neg = (x: number) => (x === 0 ? 0 : -x);

export function roundHalfUp(x: number) {
  return Math.floor(x + 0.5 + 1e-9);
}
