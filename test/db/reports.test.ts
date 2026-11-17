// Reports, checked against a day of business worked out by hand (numbers in the comments).
import { beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, type Person, type TestDb } from "./harness";
import { assertBooksBalance } from "./invariants";

let t: TestDb;
let owner: Person, manager: Person, desk: Person, tech: Person;
let ticket: string;
const key = () => randomUUID();
let today: string;

const acct = async (name: string) => (await t.admin(`select id from accounts where shop_id = $1 and (name = $2 or system_key = $2)`, [t.shopA, name]))[0].id;
const expense = async (account: string, total: number, hst: number, claim: boolean, ticketId: string | null = null) =>
  t.as(owner, `select create_expense(current_date, 'Vendor', $1, $2, $3, $4, true, null, 'bank', $5, null, null, $6)`, [await acct(account), total, hst, claim, ticketId, key()]);
const N = (rows: any[], field = "amount_cents") => rows.map((r) => ({ ...r, [field]: Number(r[field]) }));

beforeAll(async () => {
  t = await createTestDb();
  ({ ownerA: owner, managerA: manager, deskA: desk, techA: tech } = t.people);
  today = (await t.as(owner, `select shop_today()::text d`))[0].d;
  const cust = (await t.admin(`insert into customers (shop_id, first_name, last_name) values ($1, 'Dana', 'Lee') returning id`, [t.shopA]))[0].id;
  ticket = (await t.admin(`insert into tickets (shop_id, number, customer_id, device_type, brand, model, problem) values ($1, 1001, $2, 'Phone', 'Apple', 'iPhone 13', 'Screen') returning id`, [t.shopA, cust]))[0].id;

  await t.as(desk, `select open_cash_session(20000)`);                                       // float $200 (owner's money)
  await t.as(desk, `select record_deposit($1, 'debit', 5000, null, $2)`, [ticket, key()]);   // $50 deposit at check-in
  // Invoice 1001: screen $189.00 (part cost $62) → $213.57; deposit $50 + debit $163.57
  await t.as(desk, `select create_invoice(null, $1, $2::jsonb, 0, $3::jsonb, null, $4)`, [ticket,
    JSON.stringify([{ description: "Screen", category: "repair", qty: 1, unit_price_cents: 18900, unit_cost_cents: 6200 }]),
    JSON.stringify([{ method: "debit", amount_cents: 16357 }]), key()]);
  // Invoice 1002: 2 × case $50 − $10 discount → $90 + $11.70 HST = $101.70, cash
  const i2 = (await t.as(desk, `select create_invoice(null, null, $1::jsonb, 1000, $2::jsonb, null, $3) r`, [
    JSON.stringify([{ description: "Case", category: "accessory", qty: 2, unit_price_cents: 5000 }]),
    JSON.stringify([{ method: "cash", amount_cents: 10170 }]), key()]))[0].r;
  // Invoice 1003: used phone $500 → $565, not paid yet
  await t.as(desk, `select create_invoice($1, null, $2::jsonb, 0, '[]', null, $3)`, [cust,
    JSON.stringify([{ description: "iPhone 12 (used)", category: "device", qty: 1, unit_price_cents: 50000 }]), key()]);
  // One case comes back: credit $50 − $5 discount + $5.85 HST = $50.85, refunded in cash
  const item = (await t.admin(`select id from invoice_items where invoice_id = $1`, [i2.id]))[0].id;
  await t.as(manager, `select create_credit_note($1, $2::jsonb, 'returned', $3::jsonb, $4)`, [i2.id,
    JSON.stringify([{ invoice_item_id: item, qty: 1 }]), JSON.stringify([{ method: "cash", amount_cents: 5085 }]), key()]);
  await expense("Parts & supplies for repairs", 5650, 650, true);     // $50 + $6.50 HST back
  await expense("Wages & payroll", 100000, 0, false);                  // $1,000 wages
  await expense("outsourced", 11300, 1300, true, ticket);              // $100 + $13 HST, for this ticket
  // Drawer should hold 200 + 101.70 − 50.85 = $250.85; counted $245.85 → $5 short
  await t.as(desk, `select close_cash_session(24585, null)`);
  await assertBooksBalance(t);
});

describe("reports match the day worked out by hand", () => {
  test("profit & loss", async () => {
    const rows = N(await t.as(owner, `select * from report_pnl($1::date, $1::date)`, [today]));
    const get = (name: string) => rows.find((r) => r.name === name)?.amount_cents;
    expect(get("Sales – Repairs")).toBe(18900);
    expect(get("Sales – Accessories")).toBe(5000);         // $100 − $50 returned
    expect(get("Sales – Devices")).toBe(50000);
    expect(get("Discounts given")).toBe(-500);             // $10 − $5 credited back
    expect(get("Parts & supplies for repairs")).toBe(5000);
    expect(get("Outsourced repairs")).toBe(10000);
    expect(get("Wages & payroll")).toBe(100000);
    expect(get("Cash over/short")).toBe(500);
    const sum = (s: string) => rows.filter((r) => r.section === s).reduce((a, r) => a + r.amount_cents, 0);
    expect(sum("income")).toBe(73400);
    expect(sum("cost_of_sales")).toBe(15000);
    expect(sum("expense")).toBe(100500);
    expect(sum("income") - sum("cost_of_sales") - sum("expense")).toBe(-42100);
  });

  test("HST return", async () => {
    const h = (await t.as(owner, `select report_hst($1::date, $1::date) h`, [today]))[0].h;
    expect(h.line_101_sales_cents).toBe(73400);
    expect(h.line_103_hst_collected_cents).toBe(2457 + 1170 - 585 + 6500); // 95.42
    expect(h.line_106_itc_cents).toBe(650 + 1300);
    expect(h.line_109_net_tax_cents).toBe(9542 - 1950);
    expect(h.itcs_without_receipt).toBe(0);
  });

  test("balance sheet balances, and its profit equals the P&L", async () => {
    const rows = N(await t.as(owner, `select * from report_balance_sheet($1::date)`, [today]));
    const sum = (s: string) => rows.filter((r) => r.section === s).reduce((a, r) => a + r.amount_cents, 0);
    const get = (name: string) => rows.find((r) => r.name === name)?.amount_cents;
    expect(get("Cash drawer")).toBe(24585);
    expect(get("Card payments (Moneris)")).toBe(21357);
    expect(get("Customers owe us (A/R)")).toBe(56500);
    expect(get("Bank account")).toBe(-116950);
    expect(get("HST collected")).toBe(9542);
    expect(get("HST paid on expenses (ITCs)")).toBe(-1950);
    expect(get("Owner contributions")).toBe(20000);
    expect(get("Profit to date")).toBe(-42100);
    expect(sum("asset")).toBe(sum("liability") + sum("equity"));
  });

  test("unpaid invoices: only 1003, and the total equals the A/R account", async () => {
    const rows = N(await t.as(owner, `select * from report_ar_aging($1::date)`, [today]), "balance_cents");
    expect(rows.map((r) => [r.number, r.balance_cents, r.customer])).toEqual([[1003, 56500, "Dana Lee"]]);
  });

  test("money taken by method", async () => {
    const rows = await t.as(owner, `select method::text, payments_cents, deposits_cents, refunds_cents, net_cents from report_payments($1::date, $1::date)`, [today]);
    const m = Object.fromEntries(rows.map((r) => [r.method, [r.payments_cents, r.deposits_cents, r.refunds_cents, r.net_cents].map(Number)]));
    expect(m.debit).toEqual([16357, 5000, 0, 21357]);
    expect(m.cash).toEqual([10170, 0, 5085, 5085]);
  });

  test("cash drawer day", async () => {
    const r = (await t.as(owner, `select * from report_cash($1::date, $1::date)`, [today]))[0];
    expect([r.open_counted_cents, r.open_difference_cents, r.close_expected_cents, r.close_counted_cents, r.over_short_cents].map(Number))
      .toEqual([20000, 20000, 25085, 24585, -500]);
    expect(r.opened_by).toBe("front_desk A");
  });

  test("profit per repair: $189 − $62 parts − $100 outsourced = $27", async () => {
    const r = (await t.as(owner, `select * from report_ticket_profit($1::date, $1::date)`, [today]))[0];
    expect([r.ticket_number, r.revenue_cents, r.parts_cents, r.outsourced_cents, r.profit_cents].map(Number)).toEqual([1001, 18900, 6200, 10000, 2700]);
    expect(r.device).toBe("Apple iPhone 13");
  });

  test("expenses list", async () => {
    const rows = await t.as(owner, `select category, total_cents, ticket_number from report_expenses($1::date, $1::date)`, [today]);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.category === "Outsourced repairs").ticket_number).toBe(1001);
  });

  test("home page numbers", async () => {
    const d = (await t.as(manager, `select dashboard_money($1::date, $1::date) d`, [today]))[0].d;
    expect([d.sales_cents, d.costs_cents, d.net_profit_cents, d.hst_owing_cents]).toEqual([73400, 115500, -42100, 7592]);
    expect(d.money_in).toEqual({ debit: 21357, cash: 5085 });
    expect([d.invoices.open_count, d.invoices.open_cents, d.invoices.paid_count, d.invoices.paid_cents]).toEqual([1, 56500, 2, 31527]);
    expect(d.series).toEqual([{ date: today, sales_cents: 73400, costs_cents: 115500 }]);
  });

  test("a long range is grouped by month and still adds up", async () => {
    const d = (await t.as(owner, `select dashboard_money(($1::date - 365), $1::date) d`, [today]))[0].d;
    expect(d.series_by).toBe("month");
    expect(d.series.reduce((a: number, s: any) => a + s.sales_cents, 0)).toBe(d.sales_cents);
    expect(d.series.length).toBeGreaterThanOrEqual(12);
  });

  test("an empty period is all zeros, not an error", async () => {
    const d = (await t.as(owner, `select dashboard_money('2020-01-01', '2020-01-31') d`))[0].d;
    expect([d.sales_cents, d.costs_cents, d.net_profit_cents]).toEqual([0, 0, 0]);
    expect(await t.as(owner, `select * from report_pnl('2020-01-01', '2020-01-31')`)).toEqual([]);
  });
});

describe("who can see reports", () => {
  test("technicians and front desk can't", async () => {
    for (const who of [tech, desk]) {
      await expect(t.as(who, `select * from report_pnl(current_date, current_date)`)).rejects.toThrow(/role/);
      await expect(t.as(who, `select dashboard_money(current_date, current_date)`)).rejects.toThrow(/role/);
      await expect(t.as(who, `select report_hst(current_date, current_date)`)).rejects.toThrow(/role/);
    }
  });

  test("another shop sees its own (empty) books", async () => {
    const d = (await t.as(t.people.ownerB, `select dashboard_money(current_date, current_date) d`))[0].d;
    expect(d.sales_cents).toBe(0);
  });

  test("silly ranges are refused", async () => {
    await expect(t.as(owner, `select * from report_pnl('2026-02-01', '2026-01-01')`)).rejects.toThrow(/before the start/);
    await expect(t.as(owner, `select * from report_pnl(null, current_date)`)).rejects.toThrow(/date range/);
  });
});
