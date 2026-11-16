// Money actions: invoices, payments, deposits, credit notes, voids. After every test the
// books are checked end to end (test/db/invariants.ts).
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import fc from "fast-check";
import { randomUUID } from "node:crypto";
import { createTestDb, type Person, type TestDb } from "./harness";
import { assertBooksBalance } from "./invariants";

let t: TestDb;
let owner: Person, manager: Person, desk: Person, tech: Person, ownerB: Person;
let customer: string;

const key = () => randomUUID();
type Line = { description?: string; category?: string; qty?: number | string; unit_price_cents: number | string; unit_cost_cents?: number; tax_code?: string };
const line = (price: number, extra: Partial<Line> = {}): Line => ({ description: "Screen replacement", category: "repair", qty: 1, unit_price_cents: price, ...extra });

async function invoice(who: Person, opts: { lines: Line[]; discount?: number; payments?: any[]; ticket?: string | null; customer?: string | null; k?: string }) {
  const r = await t.as(who, `select create_invoice($1, $2, $3::jsonb, $4, $5::jsonb, null, $6) as r`, [
    opts.customer === undefined ? customer : opts.customer, opts.ticket ?? null, JSON.stringify(opts.lines), opts.discount ?? 0,
    JSON.stringify(opts.payments ?? []), opts.k ?? key(),
  ]);
  return r[0].r as { id: string; number: number; replayed: boolean };
}
const inv = async (id: string) => (await t.admin(`select * from invoices where id = $1`, [id]))[0];
const pay = (who: Person, id: string, method: string, cents: number, k = key()) =>
  t.as(who, `select add_payment($1, $2::payment_method, $3, null, $4) as id`, [id, method, cents, k]);
const accountBal = async (k: string, shop = t.shopA) =>
  Number((await t.admin(`select coalesce(sum(debit_cents - credit_cents),0) b from journal_lines jl join accounts a on a.id = jl.account_id where jl.shop_id = $1 and a.system_key = $2`, [shop, k]))[0].b);
async function newTicket(cust = customer, shop = t.shopA) {
  const n = (await t.admin(`update shops set next_ticket_number = next_ticket_number + 1 where id = $1 returning next_ticket_number - 1 as n`, [shop]))[0].n;
  return (await t.admin(`insert into tickets (shop_id, number, customer_id, device_type, problem) values ($1, $2, $3, 'Phone', 'Screen') returning id`, [shop, n, cust]))[0].id as string;
}
async function openDrawer(shop = t.shopA, who = owner) {
  if ((await t.admin(`select 1 from cash_sessions where shop_id = $1 and closed_at is null`, [shop])).length) return;
  await t.admin(`insert into cash_sessions (shop_id, opened_by, open_expected_cents, open_counted_cents) values ($1, $2, 0, 0)`, [shop, who.staffId]);
}

beforeAll(async () => {
  t = await createTestDb();
  ({ ownerA: owner, managerA: manager, deskA: desk, techA: tech, ownerB } = t.people);
  customer = (await t.admin(`insert into customers (shop_id, first_name, phone) values ($1, 'Alice', '+19055550001') returning id`, [t.shopA]))[0].id;
});

afterEach(async () => {
  await assertBooksBalance(t);
});

describe("chart of accounts and numbering", () => {
  test("every shop gets its own books and starts at its own invoice number", async () => {
    const a = await t.admin(`select count(*)::int n from accounts where shop_id = $1`, [t.shopA]);
    const b = await t.admin(`select count(*)::int n from accounts where shop_id = $1`, [t.shopB]);
    expect(a[0].n).toBeGreaterThan(25);
    expect(b[0].n).toBe(a[0].n);
    expect((await t.admin(`select next_value from document_counters where shop_id = $1 and kind = 'invoice'`, [t.shopA]))[0].next_value).toBe(1001);
    expect((await t.admin(`select next_value from document_counters where shop_id = $1 and kind = 'invoice'`, [t.shopB]))[0].next_value).toBe(5001);
  });
});

describe("invoices", () => {
  test("a $189 repair paid by debit: every account moves exactly", async () => {
    const before = { sales: await accountBal("sales_repair"), hst: await accountBal("hst_collected"), card: await accountBal("card_clearing") };
    const r = await invoice(desk, { lines: [line(18900, { unit_cost_cents: 6200 })], payments: [{ method: "debit", amount_cents: 21357 }] });
    expect(r.number).toBe(1001);
    const i = await inv(r.id);
    expect([i.subtotal_cents, i.tax_cents, i.total_cents, i.paid_cents, i.status].map(String)).toEqual(["18900", "2457", "21357", "21357", "paid"]);
    expect((await accountBal("sales_repair")) - before.sales).toBe(-18900);
    expect((await accountBal("hst_collected")) - before.hst).toBe(-2457);
    expect((await accountBal("card_clearing")) - before.card).toBe(21357);
  });

  test("HST is rounded once per invoice: 3 × $0.33 = $0.99 → $0.13 tax (not 3 × $0.04)", async () => {
    const r = await invoice(desk, { lines: [line(33), line(33), line(33)] });
    const i = await inv(r.id);
    expect(Number(i.tax_cents)).toBe(13);
    expect(Number(i.total_cents)).toBe(112);
  });

  test("a $10 discount splits across lines to the exact cent", async () => {
    const r = await invoice(desk, { lines: [line(3333), line(3333), line(3334)], discount: 1000 });
    const items = await t.admin(`select discount_cents from invoice_items where invoice_id = $1 order by line_no`, [r.id]);
    expect(items.map((x) => Number(x.discount_cents)).reduce((a, b) => a + b)).toBe(1000);
    expect(Number((await inv(r.id)).tax_cents)).toBe(1170); // 13% of $90.00
  });

  test("mixed taxable and tax-exempt lines", async () => {
    const r = await invoice(desk, { lines: [line(10000), line(5000, { tax_code: "EXEMPT", category: "other" })] });
    const i = await inv(r.id);
    expect([i.taxable_base_cents, i.tax_cents, i.total_cents].map(Number)).toEqual([10000, 1300, 16300]);
  });

  test("bad input is refused and doesn't use up an invoice number", async () => {
    const next = async () => Number((await t.admin(`select next_value from document_counters where shop_id = $1 and kind = 'invoice'`, [t.shopA]))[0].next_value);
    const start = await next();
    const bad: Line[][] = [
      [line(-100)],
      [line(100, { qty: 0 })],
      [line(100, { qty: 1.5 })],
      [{ description: "Screen", unit_price_cents: "12.50" }], // dollars-with-decimals sneaking in as cents
      [line(100, { description: "  " })],
      [line(100, { category: "magic" })],
      [],
    ];
    for (const lines of bad) {
      await expect(invoice(desk, { lines })).rejects.toThrow();
    }
    await expect(invoice(desk, { lines: [line(1000)], discount: 1001 })).rejects.toThrow(/more than the subtotal/);
    await expect(invoice(desk, { lines: [line(1000)], discount: -1 })).rejects.toThrow(/negative/);
    expect(await next()).toBe(start);
    const ok = await invoice(desk, { lines: [line(1000)], discount: 1000 }); // 100% discount is allowed
    expect(ok.number).toBe(start);
    expect((await inv(ok.id)).status).toBe("paid"); // nothing to pay
  });

  test("double-click safe: the same key returns the same invoice, nothing added", async () => {
    const k = key();
    const a = await invoice(desk, { lines: [line(5000)], k });
    const count = async () => Number((await t.admin(`select count(*) n from journal_entries`))[0].n);
    const c = await count();
    const b = await invoice(desk, { lines: [line(9999)], k });
    expect(b.id).toBe(a.id);
    expect(b.replayed).toBe(true);
    expect(await count()).toBe(c);
  });

  test("numbers have no gaps and no repeats", async () => {
    const nums: number[] = [];
    for (let i = 0; i < 5; i++) nums.push((await invoice(desk, { lines: [line(100)] })).number);
    expect(nums).toEqual(nums.map((_, i) => nums[0] + i));
  });

  test("the preview uses the same maths as the real invoice", async () => {
    const lines = [line(3333), line(3333, { tax_code: "EXEMPT" }), line(3334, { qty: 3 })];
    const q = (await t.as(desk, `select quote_invoice($1::jsonb, 777) as q`, [JSON.stringify(lines)]))[0].q;
    const r = await inv((await invoice(desk, { lines, discount: 777 })).id);
    expect([q.subtotal_cents, q.discount_cents, q.tax_cents, q.total_cents].map(Number)).toEqual(
      [r.subtotal_cents, r.discount_cents, r.tax_cents, r.total_cents].map(Number)
    );
  });
});

describe("payments", () => {
  test("part payments, then paid; overpaying or paying twice is refused", async () => {
    const r = await invoice(desk, { lines: [line(10000)] }); // $113.00
    await pay(desk, r.id, "credit", 5000);
    expect((await inv(r.id)).status).toBe("partial");
    await expect(pay(desk, r.id, "debit", 6301)).rejects.toThrow(/more than the balance/);
    await pay(desk, r.id, "etransfer", 6300);
    expect((await inv(r.id)).status).toBe("paid");
    await expect(pay(desk, r.id, "debit", 1)).rejects.toThrow(/already paid/);
  });

  test("double-click safe payment", async () => {
    const r = await invoice(desk, { lines: [line(10000)] });
    const k = key();
    const a = await pay(desk, r.id, "debit", 1000, k);
    const b = await pay(desk, r.id, "debit", 1000, k);
    expect(b[0].id).toBe(a[0].id);
    expect(Number((await inv(r.id)).paid_cents)).toBe(1000);
  });

  test("cash needs an open drawer", async () => {
    const r = await t.as(ownerB, `select create_invoice(null, null, $1::jsonb, 0, '[]', null, $2) as r`, [JSON.stringify([line(1000)]), key()]);
    await expect(pay(ownerB, r[0].r.id, "cash", 1130)).rejects.toThrow(/open the cash drawer/);
  });

  test("cash rounds to the nickel for every ending cent, and settles exactly", async () => {
    await openDrawer();
    for (let c = 0; c <= 9; c++) {
      const r = await invoice(desk, { lines: [line(1000 + c, { tax_code: "EXEMPT" })] });
      const nickel = Math.floor((1000 + c + 2) / 5) * 5;
      await pay(desk, r.id, "cash", nickel);
      const i = await inv(r.id);
      expect(i.status, `ending ${c}`).toBe("paid");
      const p = (await t.admin(`select amount_cents, applied_cents, rounding_cents from payments where invoice_id = $1`, [r.id]))[0];
      expect([p.amount_cents, p.applied_cents, p.rounding_cents].map(Number)).toEqual([nickel, 1000 + c, 1000 + c - nickel]);
    }
  });

  test("cash: no pennies, no overpaying, part payments are not rounded", async () => {
    await openDrawer();
    const r = await invoice(desk, { lines: [line(1003, { tax_code: "EXEMPT" })] });
    await expect(pay(desk, r.id, "cash", 1003)).rejects.toThrow(/5¢/);
    await expect(pay(desk, r.id, "cash", 2000)).rejects.toThrow(/more than the balance/);
    await pay(desk, r.id, "cash", 500);
    expect(Number((await inv(r.id)).paid_cents)).toBe(500);
    await pay(desk, r.id, "cash", 505); // balance 5.03 → 5.05 settles it
    expect((await inv(r.id)).status).toBe("paid");
  });
});

describe("deposits", () => {
  test("deposit at check-in is held, then used on the invoice", async () => {
    const tk = await newTicket();
    await t.as(tech, `select record_deposit($1, 'debit', 5000, null, $2)`, [tk, key()]);
    expect(Number((await t.as(desk, `select ticket_deposit_cents($1) b`, [tk]))[0].b)).toBe(5000);
    const r = await invoice(desk, { lines: [line(18900)], ticket: tk, customer: null });
    let i = await inv(r.id);
    expect([i.paid_cents, i.status].map(String)).toEqual(["5000", "partial"]);
    expect(i.customer_id).toBe(customer);
    await pay(desk, r.id, "debit", 21357 - 5000);
    i = await inv(r.id);
    expect(i.status).toBe("paid");
    expect(Number((await t.as(desk, `select ticket_deposit_cents($1) b`, [tk]))[0].b)).toBe(0);
  });

  test("a deposit bigger than the bill: the rest stays on the ticket until refunded", async () => {
    const tk = await newTicket();
    await t.as(desk, `select record_deposit($1, 'credit', 30000, null, $2)`, [tk, key()]);
    const r = await invoice(desk, { lines: [line(18900)], ticket: tk });
    expect((await inv(r.id)).status).toBe("paid");
    expect(Number((await t.as(desk, `select ticket_deposit_cents($1) b`, [tk]))[0].b)).toBe(30000 - 21357);
    await expect(t.as(desk, `select refund_deposit($1, 'credit', 8643, 'leftover', $2)`, [tk, key()])).rejects.toThrow(/role/);
    await expect(t.as(manager, `select refund_deposit($1, 'credit', 8644, 'leftover', $2)`, [tk, key()])).rejects.toThrow(/more than the deposit/);
    await t.as(manager, `select refund_deposit($1, 'credit', 8643, 'leftover', $2)`, [tk, key()]);
    expect(Number((await t.as(desk, `select ticket_deposit_cents($1) b`, [tk]))[0].b)).toBe(0);
  });

  test("a deposit is applied once, even over two invoices", async () => {
    const tk = await newTicket();
    await t.as(desk, `select record_deposit($1, 'debit', 10000, null, $2)`, [tk, key()]);
    const a = await invoice(desk, { lines: [line(5000)], ticket: tk }); // $56.50
    const b = await invoice(desk, { lines: [line(5000)], ticket: tk });
    expect(Number((await inv(a.id)).paid_cents)).toBe(5650);
    expect(Number((await inv(b.id)).paid_cents)).toBe(10000 - 5650);
  });
});

describe("credit notes and refunds", () => {
  test("full credit on a paid invoice: money must go back, HST and sales reverse", async () => {
    const r = await invoice(desk, { lines: [line(10000)], payments: [{ method: "credit", amount_cents: 11300 }] });
    const item = (await t.admin(`select id from invoice_items where invoice_id = $1`, [r.id]))[0].id;
    const cn = (lines: any, refunds: any) => t.as(manager, `select create_credit_note($1, $2::jsonb, 'customer changed mind', $3::jsonb, $4) r`, [r.id, JSON.stringify(lines), JSON.stringify(refunds), key()]);
    await expect(t.as(desk, `select create_credit_note($1, $2::jsonb, 'x', '[]', $3)`, [r.id, JSON.stringify([{ invoice_item_id: item, qty: 1 }]), key()])).rejects.toThrow(/role/);
    await expect(cn([{ invoice_item_id: item, qty: 1 }], [])).rejects.toThrow(/refund at least/);
    await expect(cn([{ invoice_item_id: item, qty: 1 }], [{ method: "credit", amount_cents: 11301 }])).rejects.toThrow(/more than/);
    await cn([{ invoice_item_id: item, qty: 1 }], [{ method: "credit", amount_cents: 11300 }]);
    const i = await inv(r.id);
    expect([i.paid_cents, i.credited_cents, i.status].map(String)).toEqual(["0", "11300", "credited"]);
    await expect(cn([{ invoice_item_id: item, qty: 1 }], [])).rejects.toThrow(/at most 0/);
  });

  test("crediting one at a time adds up exactly to the original line", async () => {
    const r = await invoice(desk, { lines: [line(3333, { qty: 3, category: "accessory" })], discount: 100 });
    const item = (await t.admin(`select * from invoice_items where invoice_id = $1`, [r.id]))[0];
    for (let i = 0; i < 3; i++) {
      await t.as(owner, `select create_credit_note($1, $2::jsonb, 'returned', '[]', $3)`, [r.id, JSON.stringify([{ invoice_item_id: item.id, qty: 1 }]), key()]);
    }
    const sums = (await t.admin(`select sum(gross_cents) g, sum(discount_cents) d, sum(tax_cents) x from credit_note_items where invoice_item_id = $1`, [item.id]))[0];
    expect([sums.g, sums.d, sums.x].map(Number)).toEqual([item.gross_cents, item.discount_cents, item.tax_cents].map(Number));
    expect((await inv(r.id)).status).toBe("credited");
  });
});

describe("void", () => {
  test("voiding an unpaid invoice puts every account back; the number stays used", async () => {
    const keys = ["ar", "sales_repair", "hst_collected", "discounts"];
    const before = await Promise.all(keys.map((k) => accountBal(k)));
    const r = await invoice(desk, { lines: [line(25000)], discount: 500 });
    await expect(t.as(desk, `select void_invoice($1, 'mistake')`, [r.id])).rejects.toThrow(/role/);
    await expect(t.as(owner, `select void_invoice($1, '')`, [r.id])).rejects.toThrow(/reason/);
    await t.as(owner, `select void_invoice($1, 'typed wrong price')`, [r.id]);
    expect(await Promise.all(keys.map((k) => accountBal(k)))).toEqual(before);
    const i = await inv(r.id);
    expect(i.status).toBe("void");
    expect((await invoice(desk, { lines: [line(100)] })).number).toBe(i.number + 1);
  });

  test("an invoice with payments can't be voided; a deposit goes back on the ticket", async () => {
    const paid = await invoice(desk, { lines: [line(1000)], payments: [{ method: "debit", amount_cents: 500 }] });
    await expect(t.as(owner, `select void_invoice($1, 'x')`, [paid.id])).rejects.toThrow(/credit note/);
    const tk = await newTicket();
    await t.as(desk, `select record_deposit($1, 'debit', 2000, null, $2)`, [tk, key()]);
    const r = await invoice(desk, { lines: [line(5000)], ticket: tk });
    expect(Number((await t.as(desk, `select ticket_deposit_cents($1) b`, [tk]))[0].b)).toBe(0);
    await t.as(manager, `select void_invoice($1, 'wrong ticket')`, [r.id]);
    expect(Number((await t.as(desk, `select ticket_deposit_cents($1) b`, [tk]))[0].b)).toBe(2000);
  });
});

describe("the journal can't be tampered with", () => {
  test("no edits, deletes or truncates, not even by an admin", async () => {
    await expect(t.admin(`update journal_lines set debit_cents = debit_cents + 1`)).rejects.toThrow(/can't be changed/);
    await expect(t.admin(`delete from journal_lines`)).rejects.toThrow(/can't be changed/);
    await expect(t.admin(`delete from journal_entries`)).rejects.toThrow(/can't be changed/);
    await expect(t.admin(`truncate journal_lines`)).rejects.toThrow();
  });

  test("an entry that doesn't balance is refused when it's saved", async () => {
    const acct = (await t.admin(`select id from accounts where shop_id = $1 and system_key = 'cash'`, [t.shopA]))[0].id;
    await expect(
      t.db.transaction(async (tx) => {
        const e = await tx.query<{ id: string }>(`insert into journal_entries (shop_id, entry_date, source_type) values ($1, current_date, 'cash_count') returning id`, [t.shopA]);
        await tx.query(`insert into journal_lines (shop_id, entry_id, line_no, account_id, debit_cents) values ($1, $2, 1, $3, 100)`, [t.shopA, e.rows[0].id, acct]);
      })
    ).rejects.toThrow(/does not balance/);
  });

  test("locked books refuse new postings", async () => {
    await t.admin(`update shops set books_locked_through = current_date + 1 where id = $1`, [t.shopB]);
    await expect(t.as(ownerB, `select create_invoice(null, null, $1::jsonb, 0, '[]', null, $2)`, [JSON.stringify([line(100)]), key()])).rejects.toThrow(/locked/);
    await t.admin(`update shops set books_locked_through = null where id = $1`, [t.shopB]);
  });

  test("entries are dated with Toronto's date", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
    const r = await invoice(desk, { lines: [line(100)] });
    const d = (await t.admin(`select to_char(issue_date, 'YYYY-MM-DD') d from invoices where id = $1`, [r.id]))[0].d;
    expect(d).toBe(today);
  });
});

describe("who can touch money", () => {
  test("technicians can't see or make invoices, and nobody writes money tables directly", async () => {
    await invoice(desk, { lines: [line(100)] });
    expect(await t.as(tech, `select * from invoices`)).toEqual([]);
    expect(await t.as(tech, `select * from payments`)).toEqual([]);
    await expect(invoice(tech, { lines: [line(100)] })).rejects.toThrow(/role/);
    await expect(t.as(tech, `select quote_invoice('[]'::jsonb, 0)`)).rejects.toThrow(/role/);
    for (const who of [owner, desk, tech]) {
      await t.rejects(who, `insert into invoices (shop_id, number, issue_date, tax_name, tax_rate, subtotal_cents, discount_cents, taxable_base_cents, tax_cents, total_cents) values ($1, 9999, current_date, 'HST', 0, 0, 0, 0, 0, 0)`, [t.shopA]);
      await t.rejects(who, `update invoices set paid_cents = total_cents`);
      await t.rejects(who, `delete from payments`);
      await t.rejects(who, `insert into journal_entries (shop_id, entry_date, source_type) values ($1, current_date, 'cash_count')`, [t.shopA]);
    }
  });

  test("front desk sees invoices but not part costs or the ledger", async () => {
    await invoice(desk, { lines: [line(100, { unit_cost_cents: 40 })] });
    expect((await t.as(desk, `select id from invoices`)).length).toBeGreaterThan(0);
    await t.rejects(desk, `select unit_cost_cents from invoice_items`);
    expect(await t.as(desk, `select * from journal_lines`)).toEqual([]);
    expect((await t.as(manager, `select * from journal_lines`)).length).toBeGreaterThan(0);
    await expect(t.as(desk, `select * from invoice_item_costs(gen_random_uuid())`)).rejects.toThrow(/role/);
  });

  test("helpers in the private schema can't be called from the app", async () => {
    await t.rejects(owner, `select private.round_nickel(3)`);
    await t.rejects(owner, `select private.post(null, null, current_date, 'invoice', null, null, '[]')`);
  });

  test("another shop can't touch our invoices", async () => {
    const r = await invoice(desk, { lines: [line(1000)] });
    await expect(pay(ownerB, r.id, "debit", 100)).rejects.toThrow(/not found/);
    await expect(t.as(ownerB, `select void_invoice($1, 'x')`, [r.id])).rejects.toThrow(/not found/);
    expect(await t.as(ownerB, `select * from invoices where id = $1`, [r.id])).toEqual([]);
  });
});

describe("random sequences of real-world actions", () => {
  test("the books always add up", async () => {
    await openDrawer();
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            lines: fc.array(fc.record({ price: fc.integer({ min: 0, max: 60000 }), qty: fc.integer({ min: 1, max: 4 }), exempt: fc.boolean(), cat: fc.constantFrom("repair", "device", "accessory", "other") }), { minLength: 1, maxLength: 4 }),
            discountPct: fc.integer({ min: 0, max: 100 }),
            then: fc.constantFrom("nothing", "pay_part", "pay_full_cash", "pay_full_card", "void", "credit_one"),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (ops) => {
          for (const op of ops) {
            const lines = op.lines.map((l) => line(l.price, { qty: l.qty, tax_code: l.exempt ? "EXEMPT" : "HST", category: l.cat }));
            const sub = op.lines.reduce((a, l) => a + l.price * l.qty, 0);
            const r = await invoice(desk, { lines, discount: Math.floor((sub * op.discountPct) / 100) });
            const i = await inv(r.id);
            const bal = Number(i.total_cents) - Number(i.paid_cents);
            if (bal <= 0) continue;
            if (op.then === "pay_part" && bal > 1) await pay(desk, r.id, "debit", Math.floor(bal / 2));
            if (op.then === "pay_full_card") await pay(desk, r.id, "credit", bal);
            if (op.then === "pay_full_cash" && Math.floor((bal + 2) / 5) * 5 > 0) await pay(desk, r.id, "cash", Math.floor((bal + 2) / 5) * 5);
            if (op.then === "void") await t.as(owner, `select void_invoice($1, 'test')`, [r.id]);
            if (op.then === "credit_one") {
              const it = (await t.admin(`select id from invoice_items where invoice_id = $1 order by line_no limit 1`, [r.id]))[0];
              await t.as(owner, `select create_credit_note($1, $2::jsonb, 'test', '[]', $3)`, [r.id, JSON.stringify([{ invoice_item_id: it.id, qty: 1 }]), key()]).catch((e) => {
                if (!/nothing to credit/.test(e.message)) throw e;
              });
            }
          }
          await assertBooksBalance(t, t.shopA);
        }
      ),
      { numRuns: 25 }
    );
  });
});
