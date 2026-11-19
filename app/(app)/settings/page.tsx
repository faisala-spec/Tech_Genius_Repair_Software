import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/session";
import { ui } from "@/lib/ui";
import { ShopForm, AddCategoryForm, AccountRow, LockForm } from "@/components/SettingsForms";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { owner: "Owner", manager: "Manager", technician: "Technician", front_desk: "Front desk" };

export default async function SettingsPage() {
  const { supabase, staff, shop } = await requireStaff();
  if (staff.role !== "owner") redirect("/");

  const today = String((await supabase.rpc("shop_today")).data);
  const y = new Date(today + "T12:00:00Z");
  y.setUTCDate(y.getUTCDate() - 1);

  const [{ data: people }, { data: cats }] = await Promise.all([
    supabase.from("staff").select("id, full_name, email, role, active").order("role").order("full_name"),
    supabase.from("accounts").select("id, code, name, active, system_key, itc_allowed").eq("is_expense_category", true).order("sort"),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <h1 className={ui.h1}>Settings</h1>

      <section className={ui.card}>
        <h2 className={`${ui.h2} mb-4`}>Shop details</h2>
        <ShopForm shop={shop} />
      </section>

      <section className={ui.card}>
        <h2 className={`${ui.h2} mb-3`}>Staff</h2>
        <ul className="divide-y divide-zinc-100 text-sm">
          {(people ?? []).map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <span className={p.active ? "font-medium text-zinc-900" : "text-zinc-400 line-through"}>{p.full_name}</span>
                <span className="block text-xs text-zinc-500">{p.email}</span>
              </span>
              <span className={`${ui.badge} bg-zinc-100 text-zinc-700`}>{ROLE_LABEL[p.role]}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-zinc-500">Adding staff logins is the next step after this release (each person gets their own email and password).</p>
      </section>

      <section className={ui.card}>
        <h2 className={`${ui.h2} mb-1`}>Expense categories</h2>
        <p className={`${ui.muted} mb-3`}>These are the choices in “Add expense”. Your accountant can map them to tax lines.</p>
        <div className="divide-y divide-zinc-100 text-sm">
          {(cats ?? []).map((c) => (
            <AccountRow key={c.id} id={c.id} name={c.name} active={c.active} system={!!c.system_key} />
          ))}
        </div>
        <div className="mt-4 border-t border-zinc-100 pt-4">
          <AddCategoryForm />
        </div>
      </section>

      <section className={ui.card}>
        <h2 className={`${ui.h2} mb-3`}>Lock finished periods</h2>
        <LockForm lockedThrough={shop.books_locked_through ?? null} yesterday={y.toISOString().slice(0, 10)} />
      </section>
    </div>
  );
}
