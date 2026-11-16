// Expenses (HST claimed back), the daily cash drawer, and locking finished periods.
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, type Person, type TestDb } from "./harness";
import { assertBooksBalance } from "./invariants";

let t: TestDb;
let owner: Person, manager: Person, desk: Person, tech: Person, ownerB: Person;
const key = () => randomUUID();
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
const daysAgo = (d: number) => {
  const x = new Date(today() + "T12:00:00Z");
  x.setUTCDate(x.getUTCDate() - d);
  return x.toISOString().slice(0, 10);
};

const acct = async (nameOrKey: string, shop = t.shopA) =>
  (await t.admin(`select id from accounts where shop_id = $1 and (system_key = $2 or name = $2)`, [shop, nameOrKey]))[0].id as string;
const bal = async (k: string, shop = t.shopA) =>
  Number((await t.admin(`select coalesce(sum(debit_cents - credit_cents),0) b from journal_lines jl join accounts a on a.id = jl.account_id where jl.shop_id = $1 and a.system_key = $2`, [shop, k]))[0].b);

type Exp = { date?: string; vendor?: string; account: string; total: number; hst?: number; claim?: boolean; receipt?: boolean; from?: string; ticket?: string | null };
const expense = (who: Person, e: Exp) =>
  t.as(who, `select create_expense($1::date, $2, $3, $4, $5, $6, $7, null, $8, $9, null, null, $10) as id`, [
    e.date ?? today(), e.vendor ?? "Staples", e.account, e.total, e.hst ?? 0, e.claim ?? false, e.receipt ?? true, e.from ?? "bank", e.ticket ?? null, key(),
  ]).then((r) => r[0].id as string);

beforeAll(async () => {
  t = await createTestDb();
  ({ ownerA: owner, managerA: manager, deskA: desk, techA: tech, ownerB } = t.people);
});
afterEach(async () => {
  await assertBooksBalance(t);
});

describe("expenses", () => {
  test("supplies $56.50 incl. HST, paid from the bank: $50 expense + $6.50 HST to claim back", async () => {
    const supplies = await acct("Shop supplies");
    const before = { exp: await bal("hst_itc"), bank: await bal("bank") };
    await expense(manager, { account: supplies, total: 5650, hst: 650, claim: true });
    expect((await bal("hst_itc")) - before.exp).toBe(650);
    expect((await bal("bank")) - before.bank).toBe(-5650);
    const line = await t.admin(`select debit_cents from journal_lines where account_id = $1`, [supplies]);
    expect(Number(line[0].debit_cents)).toBe(5000);
  });

  test("HST that can't be claimed (wages, card fees, insurance) stays part of the cost", async () => {
    const wages = await acct("Wages & payroll");
    await expect(expense(owner, { account: wages, total: 113000, hst: 13000, claim: true })).rejects.toThrow(/can't be claimed/);
    const fees = await acct("Card processing fees");
    await expense(owner, { account: fees, total: 4520, hst: 0 });
  });

  test("bad expenses are refused", async () => {
    const rent = await acct("Rent");
    await expect(expense(desk, { account: rent, total: 100 })).rejects.toThrow(/role/);
    await expect(expense(tech, { account: rent, total: 100 })).rejects.toThrow(/role/);
    await expect(expense(owner, { account: rent, total: 0 })).rejects.toThrow(/more than \$0/);
    await expect(expense(owner, { account: rent, total: 100, hst: 101 })).rejects.toThrow(/between/);
    await expect(expense(owner, { account: rent, total: 100, claim: true })).rejects.toThrow(/no HST/);
    await expect(expense(owner, { account: rent, total: 100, date: "2999-01-01" })).rejects.toThrow(/future/);
    await expect(expense(owner, { account: rent, total: 100, vendor: " " })).rejects.toThrow(/vendor/);
    await expect(expense(owner, { account: await acct("sales_repair"), total: 100 })).rejects.toThrow(/category/);
    await expect(expense(owner, { account: await acct("Rent", t.shopB), total: 100 })).rejects.toThrow(/category/);
    await expect(expense(owner, { account: rent, total: 100, from: "pocket" })).rejects.toThrow(/how was it paid/);
  });

  test("an outsourced repair is a cost on that ticket", async () => {
    const cust = (await t.admin(`insert into customers (shop_id, first_name) values ($1, 'Bea') returning id`, [t.shopA]))[0].id;
    const tk = (await t.admin(`insert into tickets (shop_id, number, customer_id, device_type, problem) values ($1, 7001, $2, 'Laptop', 'Board repair') returning id`, [t.shopA, cust]))[0].id;
    const x = await expense(owner, { account: await acct("outsourced"), total: 11300, hst: 1300, claim: true, ticket: tk, vendor: "Board Lab" });
    const l = await t.admin(`select debit_cents, ticket_id from journal_lines where expense_id = $1 and debit_cents > 0 order by line_no`, [x]);
    expect([Number(l[0].debit_cents), l[0].ticket_id]).toEqual([10000, tk]);
  });

  test("void puts everything back", async () => {
    const keys = ["bank", "hst_itc", "credit_card"];
    const before = await Promise.all(keys.map((k) => bal(k)));
    const x = await expense(owner, { account: await acct("Advertising"), total: 22600, hst: 2600, claim: true, from: "credit_card" });
    await expect(t.as(desk, `select void_expense($1, 'dup')`, [x])).rejects.toThrow(/role/);
    await t.as(owner, `select void_expense($1, 'entered twice')`, [x]);
    expect(await Promise.all(keys.map((k) => bal(k)))).toEqual(before);
    await expect(t.as(owner, `select void_expense($1, 'again')`, [x])).rejects.toThrow(/already void/);
  });

  test("owner paid personally → owner's contribution, not the bank", async () => {
    const before = await bal("owner_equity");
    await expense(owner, { account: await acct("Software & subscriptions"), total: 2000, from: "owner" });
    expect((await bal("owner_equity")) - before).toBe(-2000);
  });

  test("double-click safe", async () => {
    const k = key();
    const call = () => t.as(owner, `select create_expense(current_date, 'X', $1, 1000, 0, false, true, null, 'bank', null, null, null, $2) id`, [null, k]);
    const rent = await acct("Rent");
    const a = await t.as(owner, `select create_expense(current_date, 'X', $1, 1000, 0, false, true, null, 'bank', null, null, null, $2) id`, [rent, k]);
    const b = await t.as(owner, `select create_expense(current_date, 'X', $1, 1000, 0, false, true, null, 'bank', null, null, null, $2) id`, [rent, k]);
    expect(b[0].id).toBe(a[0].id);
    void call;
  });

  test("owner can add and rename categories; system accounts can't be hidden", async () => {
    const id = (await t.as(manager, `select create_expense_category('Cleaning', true) id`))[0].id;
    await expect(t.as(manager, `select create_expense_category('cleaning', true)`)).rejects.toThrow(/already/);
    await expense(owner, { account: id, total: 3000 });
    await t.as(owner, `select update_account($1, 'Cleaning & janitorial', true)`, [id]);
    await expect(t.as(owner, `select update_account($1, 'Money', false)`, [await acct("cash")])).rejects.toThrow(/can't be hidden/);
    await expect(t.as(manager, `select update_account($1, 'x', true)`, [id])).rejects.toThrow(/role/);
  });
});

describe("cash drawer", () => {
  test("a full day: float, cash sale, cash expense, bank drop, close $5 short", async () => {
    // Shop B has never used the drawer.
    await expect(t.as(ownerB, `select close_cash_session(0, null)`)).rejects.toThrow(/isn't open/);
    const open = (await t.as(ownerB, `select open_cash_session(20000) r`))[0].r;
    expect(open.starting_float).toBe(true);
    expect(await bal("cash", t.shopB)).toBe(20000);
    expect(await bal("owner_equity", t.shopB)).toBe(-20000);           // the float is the owner's money, not "over"
    await expect(t.as(ownerB, `select open_cash_session(20000)`)).rejects.toThrow(/already open/);

    const inv = (await t.as(ownerB, `select create_invoice(null, null, $1::jsonb, 0, '[{"method":"cash","amount_cents":11300}]', null, $2) r`,
      [JSON.stringify([{ description: "Case", category: "accessory", qty: 1, unit_price_cents: 10000 }]), key()]))[0].r;
    expect(inv.number).toBe(5001);
    await t.as(ownerB, `select create_expense(current_date, 'Dollarama', $1, 1017, 117, true, true, null, 'cash_drawer', null, null, null, $2)`,
      [await acct("Shop supplies", t.shopB), key()]);
    expect(await bal("cash", t.shopB)).toBe(20000 + 11300 - 1015);      // $10.17 receipt → $10.15 left the drawer
    await t.as(ownerB, `select cash_movement('bank_deposit', 10000, 'night drop')`);
    const expected = 20000 + 11300 - 1015 - 10000;
    expect(await bal("cash", t.shopB)).toBe(expected);

    const close = (await t.as(ownerB, `select close_cash_session($1, 'counted twice') r`, [expected - 500]))[0].r;
    expect([close.expected_cents, close.counted_cents, close.over_short_cents]).toEqual([expected, expected - 500, -500]);
    expect(await bal("cash_over_short", t.shopB)).toBe(500);
    expect(await bal("cash", t.shopB)).toBe(expected - 500);           // books now match the real drawer
  });

  test("next morning: a different count than last night is over/short, pinned to the opener", async () => {
    const before = await bal("cash", t.shopB);
    const r = (await t.as(ownerB, `select open_cash_session($1) r`, [before + 100]))[0].r;
    expect([r.starting_float, r.difference_cents]).toEqual([false, 100]);
    const who = await t.admin(`select staff_id from journal_lines jl join journal_entries e on e.id = jl.entry_id where e.source_id = $1 limit 1`, [r.id]);
    expect(who[0].staff_id).toBe(ownerB.staffId);
    await t.as(ownerB, `select close_cash_session($1, null)`, [before + 100]);
  });

  test("rules: 5¢ steps, no cash after closing, can't drop more than is there, front desk counts but can't move cash", async () => {
    await expect(t.as(desk, `select open_cash_session(1003)`)).rejects.toThrow(/5¢/);
    await t.as(desk, `select open_cash_session(0)`);
    const st = (await t.as(desk, `select drawer_status() s`))[0].s;
    expect([st.open, st.expected_cents]).toEqual([true, null]);           // blind count for front desk
    expect((await t.as(manager, `select drawer_status() s`))[0].s.expected_cents).not.toBeNull();
    await expect(t.as(desk, `select cash_movement('owner_draw', 500, null)`)).rejects.toThrow(/role/);
    await expect(t.as(owner, `select cash_movement('bank_deposit', 999999995, null)`)).rejects.toThrow(/isn't that much/);
    await t.as(owner, `select cash_movement('float_from_bank', 5000, null)`);
    await t.as(owner, `select cash_movement('owner_draw', 2000, 'lunch')`);
    await t.as(desk, `select close_cash_session($1, null)`, [await bal("cash")]);
    const inv = (await t.as(desk, `select create_invoice(null, null, $1::jsonb, 0, '[]', null, $2) r`,
      [JSON.stringify([{ description: "Cable", category: "accessory", qty: 1, unit_price_cents: 1000 }]), key()]))[0].r;
    await expect(t.as(desk, `select add_payment($1, 'cash', 1130, null, $2)`, [inv.id, key()])).rejects.toThrow(/open the cash drawer/);
    await expect(t.as(owner, `select create_expense(current_date, 'X', $1, 500, 0, false, false, null, 'cash_drawer', null, null, null, $2)`,
      [await acct("Rent"), key()])).rejects.toThrow(/open the cash drawer/);
  });

  test("cash from the drawer can't be backdated", async () => {
    await t.as(owner, `select open_cash_session($1)`, [await bal("cash")]);
    await expect(expense(owner, { account: await acct("Rent"), total: 500, from: "cash_drawer", date: daysAgo(1) })).rejects.toThrow(/on the day/);
    await t.as(owner, `select close_cash_session($1, null)`, [await bal("cash")]);
  });
});

describe("locking finished periods", () => {
  test("lock a past date: nothing can be posted into it, by anyone", async () => {
    const rent = await acct("Rent");
    await expense(owner, { account: rent, total: 1000, date: daysAgo(3) });
    await expect(t.as(manager, `select lock_books($1::date)`, [daysAgo(2)])).rejects.toThrow(/role/);
    await expect(t.as(owner, `select lock_books($1::date)`, [today()])).rejects.toThrow(/over/);
    await t.as(owner, `select lock_books($1::date)`, [daysAgo(2)]);
    await expect(expense(owner, { account: rent, total: 1000, date: daysAgo(3) })).rejects.toThrow(/locked/);
    await expect(expense(owner, { account: rent, total: 1000, date: daysAgo(2) })).rejects.toThrow(/locked/);
    await expense(owner, { account: rent, total: 1000, date: daysAgo(1) });
    await expect(t.as(owner, `select lock_books($1::date)`, [daysAgo(5)])).rejects.toThrow(/already locked/);
    await expect(t.admin(`update shops set books_locked_through = null where id = $1`, [t.shopA]).then(() =>
      t.as(owner, `update shops set books_locked_through = null`))).rejects.toThrow();
  });

  test("unlocking needs the owner and a reason, and is recorded", async () => {
    await t.admin(`update shops set books_locked_through = $2::date where id = $1`, [t.shopA, daysAgo(2)]);
    await expect(t.as(owner, `select unlock_books(null, '')`)).rejects.toThrow(/reason/);
    await t.as(owner, `select unlock_books(null, 'accountant found a missing receipt')`);
    const log = await t.admin(`select detail from audit_log where action = 'unlock_books' order by id desc limit 1`);
    expect(log[0].detail.reason).toMatch(/missing receipt/);
  });
});
