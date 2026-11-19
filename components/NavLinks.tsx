"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Role = "owner" | "manager" | "technician" | "front_desk";
type Item = { href: string; label: string; icon: string; roles: Role[]; mobile?: boolean };

const ALL: Role[] = ["owner", "manager", "technician", "front_desk"];
const COUNTER: Role[] = ["owner", "manager", "front_desk"];
const MANAGERS: Role[] = ["owner", "manager"];

// Icons are 24×24 outline paths.
export const NAV: Item[] = [
  { href: "/", label: "Home", roles: ALL, mobile: true, icon: "M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" },
  { href: "/tickets", label: "Tickets", roles: ALL, mobile: true, icon: "M4 5h16v4a2 2 0 000 4v4H4v-4a2 2 0 000-4z" },
  { href: "/customers", label: "Customers", roles: ALL, mobile: true, icon: "M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 19v-1a4 4 0 00-3-3.9M16 3.1a3.5 3.5 0 010 6.8" },
  { href: "/invoices", label: "Sales", roles: COUNTER, mobile: true, icon: "M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6" },
  { href: "/expenses", label: "Expenses", roles: MANAGERS, icon: "M4 4h16v16H4zM8 9h8M8 13h8M8 17h4" },
  { href: "/cash", label: "Cash drawer", roles: COUNTER, icon: "M3 7h18v12H3zM3 11h18M7 15h2" },
  { href: "/reports", label: "Reports", roles: MANAGERS, icon: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
  { href: "/settings", label: "Settings", roles: ["owner"], icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-2.7-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 004.6 15H4.5a2 2 0 110-4h.1a1.6 1.6 0 001.1-2.7l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 002.7-1.1V4a2 2 0 114 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 001.1 2.7h.1a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" },
];

export default function NavLinks({ role, mobile = false }: { role: Role; mobile?: boolean }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const items = NAV.filter((i) => i.roles.includes(role));

  if (mobile) {
    const m = items.filter((i) => i.mobile);
    return (
      <nav className={`fixed inset-x-0 bottom-0 z-20 grid border-t border-zinc-200 bg-surface md:hidden`} style={{ gridTemplateColumns: `repeat(${m.length}, minmax(0, 1fr))` }}>
        {m.map((l) => (
          <Link key={l.href} href={l.href} className={`flex flex-col items-center gap-1 py-2 text-xs ${active(l.href) ? "font-semibold text-brand-dark" : "text-zinc-500"}`}>
            <Icon d={l.icon} />
            {l.label}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav className="space-y-0.5">
      {items.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${active(l.href) ? "bg-brand-soft text-brand-dark" : "text-zinc-600 hover:bg-zinc-100"}`}
        >
          <Icon d={l.icon} />
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export function Icon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
