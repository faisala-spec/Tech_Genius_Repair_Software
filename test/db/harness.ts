// Test database: the real db/*.sql files loaded into PGlite (Postgres in WebAssembly),
// plus a Supabase stand-in. Every test acts as a real signed-in staff member, with RLS on.
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const DB_DIR = path.join(ROOT, "db");

/** Migration files in the order they run on Supabase. 003 (CSV import) and 004 (manual staff add) are one-off scripts. */
export function migrationFiles() {
  const numbered = fs
    .readdirSync(DB_DIR)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.startsWith("003_") && !f.startsWith("004_"))
    .sort();
  return ["schema.sql", "seed_techgenius.sql", ...numbered];
}

export type Role = "owner" | "manager" | "technician" | "front_desk";
export type Person = { authId: string; staffId: string; role: Role; shop: "A" | "B" };

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Shop A is Tech Genius (from the seed). Shop B is a second shop, to prove isolation. */
export const PEOPLE: Record<string, Person> = {
  ownerA: { authId: uuid(1), staffId: uuid(101), role: "owner", shop: "A" },
  managerA: { authId: uuid(2), staffId: uuid(102), role: "manager", shop: "A" },
  techA: { authId: uuid(3), staffId: uuid(103), role: "technician", shop: "A" },
  deskA: { authId: uuid(4), staffId: uuid(104), role: "front_desk", shop: "A" },
  ownerB: { authId: uuid(11), staffId: uuid(111), role: "owner", shop: "B" },
  techB: { authId: uuid(13), staffId: uuid(113), role: "technician", shop: "B" },
};
export const SHOP_B = uuid(900);

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

export async function createTestDb() {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(fs.readFileSync(path.join(__dirname, "supabase_stub.sql"), "utf8"));
  for (const f of migrationFiles()) {
    // pgcrypto isn't packaged for PGlite; gen_random_uuid() is built into Postgres anyway.
    const sql = fs.readFileSync(path.join(DB_DIR, f), "utf8").replace(/create extension if not exists pgcrypto;/i, "");
    try {
      await db.exec(sql);
    } catch (e: any) {
      throw new Error(`${f}: ${e.message}`);
    }
  }

  // Fixture: second shop + one person in every role.
  await db.exec(`insert into shops (id, name, legal_name, next_ticket_number, next_invoice_number) values ('${SHOP_B}', 'Other Shop', 'Other Shop Inc.', 5001, 5001)`);
  for (const p of Object.values(PEOPLE)) {
    const shop = p.shop === "A" ? `(select id from shops where legal_name = 'Tech Genius Burlington Inc.')` : `'${SHOP_B}'`;
    await db.exec(`insert into auth.users (id, email) values ('${p.authId}', '${p.role}${p.shop}@test.local');
      insert into staff (id, shop_id, auth_user_id, full_name, email, role) values ('${p.staffId}', ${shop}, '${p.authId}', '${p.role} ${p.shop}', '${p.role}${p.shop}@test.local', '${p.role}')`);
  }

  /** Run one statement as a signed-in person (or anonymous), with RLS on, in its own transaction. */
  async function as<T = any>(who: Person | "anon", sql: string, params: any[] = []): Promise<T[]> {
    return db.transaction(async (tx: Transaction) => {
      if (who === "anon") {
        await tx.exec(`set local role anon; select set_config('request.jwt.claims', '', true);`);
      } else {
        await tx.exec(`set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${who.authId}"}', true);`);
      }
      const res = await tx.query<T>(sql, params);
      return res.rows;
    });
  }

  /** Same, but expects an error; returns its message. */
  async function rejects(who: Person | "anon", sql: string, params: any[] = []): Promise<string> {
    try {
      await as(who, sql, params);
    } catch (e: any) {
      return e.message as string;
    }
    throw new Error(`Expected this to fail but it succeeded: ${sql}`);
  }

  /** Superuser query (test setup and checks only; bypasses RLS). */
  async function admin<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return (await db.query<T>(sql, params)).rows;
  }

  const shopA = (await admin<{ id: string }>(`select id from shops where legal_name = 'Tech Genius Burlington Inc.'`))[0].id;

  return { db, as, rejects, admin, shopA, shopB: SHOP_B, people: PEOPLE };
}
