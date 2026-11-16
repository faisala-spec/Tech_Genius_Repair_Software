// Who can see and change what. Every check runs as a real signed-in person with RLS on.
import { beforeAll, describe, expect, test } from "vitest";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
let customerA: string;
let customerB: string;

beforeAll(async () => {
  t = await createTestDb();
  customerA = (await t.admin(`insert into customers (shop_id, first_name, phone) values ($1, 'Alice', '+19055550001') returning id`, [t.shopA]))[0].id;
  customerB = (await t.admin(`insert into customers (shop_id, first_name, phone) values ($1, 'Bob', '+19055550002') returning id`, [t.shopB]))[0].id;
});

const count = async (who: any, table: string) => Number((await t.as(who, `select count(*)::int as n from ${table}`))[0].n);

describe("signed-out visitors", () => {
  test("see nothing and can't write", async () => {
    for (const table of ["customers", "tickets", "staff", "shops", "audit_log"]) {
      await t.rejects("anon", `select * from ${table} limit 1`);
    }
    await t.rejects("anon", `insert into customers (shop_id, first_name) values ($1, 'x')`, [t.shopA]);
    await t.rejects("anon", `select next_number('ticket')`);
  });
});

describe("shops are sealed off from each other", () => {
  test("each shop sees only its own rows", async () => {
    const a = await t.as(t.people.ownerA, `select id from customers`);
    const b = await t.as(t.people.ownerB, `select id from customers`);
    expect(a.map((r) => r.id)).toEqual([customerA]);
    expect(b.map((r) => r.id)).toEqual([customerB]);
    expect(await count(t.people.ownerA, "shops")).toBe(1);
    expect((await t.as(t.people.ownerA, `select id from staff`)).length).toBe(4);
  });

  test("can't write into another shop", async () => {
    await t.rejects(t.people.ownerA, `insert into customers (shop_id, first_name) values ($1, 'sneaky')`, [t.shopB]);
    await t.as(t.people.ownerA, `update customers set first_name = 'hacked' where id = $1`, [customerB]);
    expect((await t.admin(`select first_name from customers where id = $1`, [customerB]))[0].first_name).toBe("Bob");
  });
});

describe("technicians and front desk", () => {
  test("can do their normal work: customers and tickets", async () => {
    for (const who of [t.people.techA, t.people.deskA]) {
      const c = await t.as(who, `insert into customers (first_name, phone) values ('Walk-in', '+19055550009') returning id, shop_id`);
      expect(c[0].shop_id).toBe(t.shopA);
      const n = (await t.as(who, `select next_number('ticket') as n`))[0].n;
      const tk = await t.as(who, `insert into tickets (number, customer_id, device_type, problem) values ($1, $2, 'Phone', 'Screen') returning id`, [n, c[0].id]);
      await t.as(who, `update tickets set status = 'diagnosing' where id = $1`, [tk[0].id]);
      await t.as(who, `insert into ticket_events (ticket_id, kind, body, staff_id) values ($1, 'note', 'hi', $2)`, [tk[0].id, who.staffId]);
    }
  });

  test("can't make themselves owner or change anyone's role", async () => {
    const tech = t.people.techA;
    await t.as(tech, `update staff set role = 'owner' where auth_user_id = $1`, [tech.authId]);
    await t.as(tech, `update staff set role = 'technician' where id = $1`, [t.people.ownerA.staffId]);
    await t.rejects(tech, `insert into staff (full_name, role) values ('fake boss', 'owner')`);
    const roles = await t.admin(`select id, role from staff where shop_id = $1 order by id`, [t.shopA]);
    expect(roles.map((r) => r.role)).toEqual(["owner", "manager", "technician", "front_desk"]);
  });

  test("can't change the tax rate, numbering or anything about the shop", async () => {
    for (const who of [t.people.techA, t.people.deskA, t.people.managerA]) {
      await t.as(who, `update shops set tax_rate = 0, tax_number = 'x'`);
    }
    await t.rejects(t.people.ownerA, `update shops set next_invoice_number = 1`);
    await t.rejects(t.people.ownerA, `update shops set next_ticket_number = 1`);
    const s = (await t.admin(`select tax_rate, tax_number, next_ticket_number from shops where id = $1`, [t.shopA]))[0];
    expect(s.tax_rate).toBe("0.1300");
    expect(s.tax_number).toBe("741942122RT0001");
  });

  test("can't delete customers or tickets", async () => {
    await t.as(t.people.techA, `delete from customers where id = $1`, [customerA]);
    expect(await t.admin(`select 1 from customers where id = $1`, [customerA])).toHaveLength(1);
    await t.rejects(t.people.ownerA, `delete from tickets`);
  });

  test("can't renumber a ticket or rewrite history", async () => {
    const tk = (await t.admin(`select id from tickets where shop_id = $1 limit 1`, [t.shopA]))[0].id;
    await t.rejects(t.people.techA, `update tickets set number = 1 where id = $1`, [tk]);
    await t.rejects(t.people.techA, `update ticket_events set body = 'changed'`);
    await t.rejects(t.people.ownerA, `delete from ticket_events`);
    // A note must be written as yourself, not as someone else.
    await t.rejects(t.people.techA, `insert into ticket_events (ticket_id, kind, body, staff_id) values ($1, 'note', 'fake', $2)`, [tk, t.people.ownerA.staffId]);
  });

  test("can't read the audit log", async () => {
    await t.admin(`insert into audit_log (shop_id, action) values ($1, 'test')`, [t.shopA]);
    expect(await count(t.people.techA, "audit_log")).toBe(0);
    expect(await count(t.people.deskA, "audit_log")).toBe(0);
    expect(await count(t.people.managerA, "audit_log")).toBe(1);
  });
});

describe("owner", () => {
  test("manages staff and shop details", async () => {
    await t.as(t.people.ownerA, `update shops set phone = '+19053333345', invoice_terms = 'terms'`);
    const s = await t.as(t.people.ownerA, `insert into staff (full_name, role) values ('New Tech', 'technician') returning id, shop_id`);
    expect(s[0].shop_id).toBe(t.shopA);
    await t.as(t.people.ownerA, `update staff set active = false where id = $1`, [s[0].id]);
  });

  test("can't lock themselves out", async () => {
    const o = t.people.ownerA;
    await t.rejects(o, `update staff set role = 'manager' where auth_user_id = $1`, [o.authId]);
    await t.rejects(o, `update staff set active = false where auth_user_id = $1`, [o.authId]);
    await t.as(o, `delete from staff where auth_user_id = $1`, [o.authId]);
    expect(await t.admin(`select 1 from staff where auth_user_id = $1`, [o.authId])).toHaveLength(1);
  });

  test("can't edit or erase the audit log, nobody can", async () => {
    await t.rejects(t.people.ownerA, `delete from audit_log`);
    await t.rejects(t.people.ownerA, `insert into audit_log (shop_id, action) values ($1, 'fake')`, [t.shopA]);
    await expect(t.admin(`update audit_log set action = 'x'`)).rejects.toThrow(/can't be changed/);
    await expect(t.admin(`delete from audit_log`)).rejects.toThrow(/can't be changed/);
  });
});
