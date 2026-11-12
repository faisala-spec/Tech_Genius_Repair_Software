import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/session";
import { cleanSearch, fullName, phonePretty, money } from "@/lib/format";
import { ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const SORTS = {
  newest: { label: "Newest first" },
  name: { label: "Name A–Z" },
  spend: { label: "Top spenders" },
  visits: { label: "Most visits" },
} as const;
type SortKey = keyof typeof SORTS;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string; archived?: string }>;
}) {
  const sp = await searchParams;
  const { supabase, shop } = await requireStaff();
  const term = cleanSearch(sp.q ?? "");
  const sort: SortKey = (sp.sort as SortKey) in SORTS ? (sp.sort as SortKey) : "newest";
  const showArchived = sp.archived === "1";
  const page = Math.max(1, Math.floor(Number(sp.page) || 1));

  // "T-1001" or "1001" → jump straight to that ticket
  const ticketMatch = term.match(/^(?:t-?\s*)?(\d{1,7})$/i);
  if (ticketMatch && (term.toLowerCase().startsWith("t") || term.length <= 5)) {
    const { data: t } = await supabase.from("tickets").select("id").eq("number", Number(ticketMatch[1])).maybeSingle();
    if (t) redirect(`/tickets/${t.id}`);
  }

  let query = supabase
    .from("customers")
    .select("id, first_name, last_name, company, phone, email, legacy_ticket_count, legacy_lifetime_spend, archived", { count: "exact" })
    .eq("archived", showArchived);

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
  }

  if (sort === "name") query = query.order("first_name", { ascending: true, nullsFirst: false }).order("last_name", { ascending: true, nullsFirst: false });
  else if (sort === "spend") query = query.order("legacy_lifetime_spend", { ascending: false });
  else if (sort === "visits") query = query.order("legacy_ticket_count", { ascending: false });
  else query = query.order("legacy_num", { ascending: false, nullsFirst: true }).order("created_at", { ascending: false });
  query = query.order("id"); // stable order across pages

  const from = (page - 1) * PAGE_SIZE;
  const { data: customers, count } = await query.range(from, from + PAGE_SIZE - 1);
  const list = customers ?? [];
  // Asked for a page past the end (e.g. an old link): go back to page 1.
  if (!list.length && page > 1) redirect(`/customers?${new URLSearchParams(Object.entries({ q: sp.q ?? "", sort: sp.sort ?? "", archived: sp.archived ?? "" }).filter(([, v]) => v))}`);
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const href = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q: sp.q, sort: sort === "newest" ? undefined : sort, archived: showArchived ? "1" : undefined, page: undefined, ...patch };
    Object.entries(merged).forEach(([k, v]) => v !== undefined && v !== "" && !(k === "page" && Number(v) <= 1) && p.set(k, String(v)));
    const s = p.toString();
    return `/customers${s ? "?" + s : ""}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={ui.h1}>Customers</h1>
          <p className={ui.muted}>
            {term ? `${total.toLocaleString("en-CA")} found for "${term}"` : `${total.toLocaleString("en-CA")} ${showArchived ? "archived" : ""} customers`}
          </p>
        </div>
        <Link href="/customers/new" className={ui.btn}>
          + New customer
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form className="flex flex-1 gap-2">
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Phone, name, email or ticket #" className={`${ui.input} max-w-md`} autoFocus />
          {sort !== "newest" && <input type="hidden" name="sort" value={sort} />}
          {showArchived && <input type="hidden" name="archived" value="1" />}
          <button className={ui.btnGhost}>Search</button>
          {term && (
            <Link href={href({ q: undefined })} className="self-center text-sm text-zinc-500 hover:underline">
              Clear
            </Link>
          )}
        </form>
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <span className="mr-1 text-zinc-500">Sort:</span>
          {(Object.keys(SORTS) as SortKey[]).map((k) => (
            <Link
              key={k}
              href={href({ sort: k === "newest" ? undefined : k })}
              className={`rounded-full px-3 py-1 ${sort === k ? "bg-brand text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
            >
              {SORTS[k].label}
            </Link>
          ))}
        </div>
      </div>

      {term && ticketMatch && !list.length && (
        <p className={ui.muted}>
          No ticket {shop.ticket_prefix}
          {ticketMatch[1]} found.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3 text-right">Visits</th>
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
                  {c.company && (c.first_name || c.last_name) && <span className="ml-2 text-xs text-zinc-500">{c.company}</span>}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{phonePretty(c.phone)}</td>
                <td className="px-4 py-3 text-zinc-600">{c.email}</td>
                <td className="px-4 py-3 text-right text-zinc-600">{c.legacy_ticket_count || ""}</td>
                <td className="px-4 py-3 text-right text-zinc-600">{money(c.legacy_lifetime_spend)}</td>
              </tr>
            ))}
            {!list.length && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-zinc-500">
                  {term ? (
                    <>
                      No customer found.{" "}
                      <Link href="/customers/new" className={ui.link}>
                        Add a new customer
                      </Link>
                    </>
                  ) : (
                    "No customers here."
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-zinc-500">
          {total > 0
            ? `Showing ${(from + 1).toLocaleString("en-CA")}–${Math.min(from + PAGE_SIZE, total).toLocaleString("en-CA")} of ${total.toLocaleString("en-CA")}`
            : ""}
          {" · "}
          <Link href={href({ archived: showArchived ? undefined : "1" })} className="hover:underline">
            {showArchived ? "Back to active customers" : "Show archived"}
          </Link>
        </p>
        {pages > 1 && (
          <div className="flex items-center gap-1">
            <PageLink href={href({ page: 1 })} disabled={page <= 1}>« First</PageLink>
            <PageLink href={href({ page: page - 1 })} disabled={page <= 1}>‹ Previous</PageLink>
            <span className="px-3 text-zinc-600">
              Page {page} of {pages}
            </span>
            <PageLink href={href({ page: page + 1 })} disabled={page >= pages}>Next ›</PageLink>
            <PageLink href={href({ page: pages })} disabled={page >= pages}>Last »</PageLink>
          </div>
        )}
      </div>
    </div>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  if (disabled) return <span className="rounded-lg border border-zinc-200 px-3 py-1.5 text-zinc-300">{children}</span>;
  return (
    <Link href={href} className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-zinc-700 hover:border-brand">
      {children}
    </Link>
  );
}
