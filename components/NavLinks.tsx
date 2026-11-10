"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home", icon: "M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" },
  { href: "/tickets", label: "Tickets", icon: "M4 5h16v4a2 2 0 000 4v4H4v-4a2 2 0 000-4z" },
  { href: "/customers", label: "Customers", icon: "M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 19v-1a4 4 0 00-3-3.9M16 3.1a3.5 3.5 0 010 6.8" },
  { href: "/invoices", label: "Invoices", icon: "M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6" },
];

export default function NavLinks({ mobile = false }: { mobile?: boolean }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  if (mobile) {
    return (
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-zinc-200 bg-white md:hidden">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`flex flex-col items-center gap-1 py-2 text-xs ${active(l.href) ? "text-brand-dark font-semibold" : "text-zinc-500"}`}
          >
            <Icon d={l.icon} />
            {l.label}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav className="space-y-1">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
            active(l.href) ? "bg-brand-soft text-brand-dark" : "text-zinc-600 hover:bg-zinc-100"
          }`}
        >
          <Icon d={l.icon} />
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
