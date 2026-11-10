import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/session";
import { cleanSearch, fullName, phonePretty, money } from "@/lib/format";
import { ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const { supabase, shop } = await requireStaff();
  const term = cleanSearch(q ?? "");

  // "T-1001" or "1001" → jump straight to that ticket
  const ticketMatch = term.match(/^(?:t-?\s*)?(\d{1,7})$/i);
  if (ticketMatch && (term.toLowerCase().startsWith("t") || term.length <= 5)) {
    const { data: t } = await supabase.from("tickets").select("id").eq("number", Number(ticketMatch[1])).maybeSingle();
    if (t) redirect(`/tickets/${t.id}`);
  }

  let query = supabase
    .from("customers")
    .select("id, first_name, last_name, company, phone, email, legacy_ticket_count, legacy_lifetime_spend, created_at")
    .eq("archived", false)
    .limit(50);

  if (term) {
    const digits = term.replace(/\D/g, "");
    const words = term.split(/\s+/).filter(Boolean);
    const filters: string[] = [];
    if (digits.length >= 3) filters.push(`phone.ilike.%${digits}%`, `phone_alt.ilike.%${digits}%`, `legacy_code.eq.${digits}`);
    if (/[a-z@]/i.test(term)) {
      filters.push(`first_name.ilike.%${words[0]}%`, `last_name.ilike.%${words.at(-1)}%`, `company.ilike.%${term}%`, `email.ilike.%${term}%`);
    }
    if (filters.length) query = query.or(filters.join(","));
    if (words.length > 1 && !digits) query = query.ilike("first_name", `%${words[0]}%`).ilike("last_name", `%${words.at(-1)}%`);
  } else {
    query = query.order("created_at", { ascending: false });
  }

  const { data: customers } = await query;
  const list = customers ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={ui.h1}>Customers</h1>
        <Link href="/customers/new" className={ui.btn}>
          + New customer
        </Link>
      </div>

      <form className="flex gap-2">
        <input name="q" defaultValue={q ?? ""} placeholder="Phone, name, email or ticket #" className={`${ui.input} max-w-md`} autoFocus />
        <button className={ui.btnGhost}>Search</button>
      </form>

      {term && ticketMatch && !list.length && (
        <p className={ui.muted}>No ticket {shop.ticket_prefix}{ticketMatch[1]} found.</p>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3 text-right">Past spend</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {list.map((c) => (
              <tr key={c.id} className="hover:bg-zinc-50">
                <td className="px-4 py-3">
                  <Link href={`/customers/${c.id}`} className={ui.link}>
                    {fullName(c)}
                  </Link>
                </td>
                <td className="px-4 py-3">{phonePretty(c.phone)}</td>
                <td className="px-4 py-3 text-zinc-600">{c.email}</td>
                <td className="px-4 py-3 text-right text-zinc-600">{money(c.legacy_lifetime_spend)}</td>
              </tr>
            ))}
            {!list.length && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-zinc-500">
                  {term ? (
                    <>
                      No customer found.{" "}
                      <Link href="/customers/new" className={ui.link}>
                        Add a new customer
                      </Link>
                    </>
                  ) : (
                    "No customers yet."
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!term && <p className={ui.muted}>Showing the 50 newest customers. Search to find anyone else.</p>}
    </div>
  );
}
