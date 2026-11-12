// Made-up numbers so the dashboard can be designed before real sales exist.
// Only used when running on a developer's computer with ?demo=1 (see app/(app)/page.tsx).
import type { Range } from "./dashboard";

const DEVICES: [string, string, string, string, number, number][] = [
  // type, brand, model, problem, price, part cost
  ["Phone", "Apple", "iPhone 13", "Screen", 189, 62],
  ["Phone", "Apple", "iPhone 14 Pro", "Screen", 329, 140],
  ["Phone", "Apple", "iPhone 12", "Battery", 99, 22],
  ["Phone", "Samsung", "Galaxy S22", "Screen", 279, 120],
  ["Phone", "Apple", "iPhone 11", "Charging port", 89, 15],
  ["Phone", "Google", "Pixel 7", "Back glass", 119, 25],
  ["Laptop", "Apple", "MacBook Air", "Battery", 229, 85],
  ["Tablet", "Apple", "iPad 9", "Screen", 159, 45],
  ["Console", "Nintendo", "Switch", "Charging port", 129, 18],
];
const STATUSES = ["received", "diagnosing", "awaiting_approval", "awaiting_parts", "in_repair", "ready"];
const METHODS = ["debit", "debit", "credit", "cash", "cash", "etransfer"];
const NAMES = [["Sam", "Lee"], ["Priya", "Shah"], ["Mike", "Brown"], ["Ana", "Silva"], ["Tom", "Nguyen"], ["Jess", "Martin"]];

/** Same shapes as the five queries on the dashboard: invoices, payments, tickets, open tickets, unpaid. */
export function demoData(range: Range): [any[], any[], any[], any[], any[]] {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const now = Date.now();
  const from = Math.min(range.prevStart, range.buckets[0].start);
  const techs = ["demo-tech-1", "demo-tech-2", null];

  const invoices: any[] = [], payments: any[] = [], tickets: any[] = [];
  for (let t = from; t < now; t += 3_600_000 * (1 + rand() * 6)) {
    const hour = new Date(t).getUTCHours() - 5;
    if (hour < 10 || hour > 19) continue; // store hours
    const [type, , , problem, price, cost] = pick(DEVICES);
    const tech = pick(techs);
    const at = new Date(t).toISOString();
    const created = new Date(t - (1 + rand() * 4) * 86_400_000).toISOString();
    tickets.push({ id: "d" + t, status: "picked_up", created_at: created, picked_up_at: at, technician_id: tech, device_type: type, problem });
    const tax = Math.round(price * 0.13 * 100) / 100;
    invoices.push({ created_at: at, status: "paid", subtotal: price, discount: 0, tax, total: price + tax, paid: price + tax, invoice_items: [{ qty: 1, unit_cost: cost }], tickets: { technician_id: tech } });
    payments.push({ created_at: at, method: pick(METHODS), amount: price + tax });
  }

  const open = Array.from({ length: 14 }, (_, i) => {
    const [type, brand, model, problem] = pick(DEVICES);
    const [first_name, last_name] = pick(NAMES);
    const created = new Date(now - rand() * 10 * 86_400_000).toISOString();
    return { id: "open" + i, number: 1001 + i, status: pick(STATUSES), created_at: created, updated_at: created, picked_up_at: null, technician_id: pick(techs), device_type: type, brand, model, problem, customers: { first_name, last_name } };
  });
  tickets.push(...open);

  return [invoices, payments, tickets, open, [{ total: 226, paid: 50 }, { total: 113, paid: 0 }]];
}
