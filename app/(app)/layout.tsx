import Link from "next/link";
import NavLinks from "@/components/NavLinks";
import { requireStaff } from "@/lib/session";
import { signOut } from "../login/actions";
import { ui } from "@/lib/ui";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  technician: "Technician",
  front_desk: "Front desk",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { staff, shop } = await requireStaff();

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-zinc-200 bg-white p-4 md:flex">
        <Link href="/" className="mb-6 flex items-center gap-2">
          <img src={shop.logo_url || "/brand/techgenius-logo.png"} alt="" className="h-10 w-auto" />
          <span className="font-bold text-zinc-900">{shop.name}</span>
        </Link>
        <Link href="/tickets/new" className={`${ui.btn} mb-4 w-full`}>
          + New ticket
        </Link>
        <NavLinks />
        <div className="mt-auto border-t border-zinc-200 pt-4">
          <p className="text-sm font-semibold text-zinc-900">{staff.full_name}</p>
          <p className="text-xs text-zinc-500">{ROLE_LABEL[staff.role]}</p>
          <form action={signOut} className="mt-2">
            <button className="text-xs text-zinc-500 hover:text-zinc-900">Sign out</button>
          </form>
        </div>
      </aside>

      <div className="flex-1 pb-20 md:pb-0">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur">
          <Link href="/" className="md:hidden">
            <img src={shop.logo_url || "/brand/techgenius-logo.png"} alt="" className="h-8 w-auto" />
          </Link>
          <form action="/customers" className="flex-1">
            <input
              name="q"
              placeholder="Search phone, name or ticket # (e.g. T-1001)"
              className={`${ui.input} max-w-xl`}
              autoComplete="off"
            />
          </form>
          <Link href="/tickets/new" className={`${ui.btn} md:hidden`}>
            + Ticket
          </Link>
        </header>
        <main className="mx-auto max-w-7xl p-4 md:p-6">{children}</main>
      </div>

      <NavLinks mobile />
    </div>
  );
}
