"use client";

// The one orange "+ Create" button (QuickBooks style): every way to start something, in one place.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ui } from "@/lib/ui";

type Role = "owner" | "manager" | "technician" | "front_desk";

const ITEMS: { href: string; label: string; hint: string; roles: Role[] }[] = [
  { href: "/tickets/new", label: "New repair ticket", hint: "Check in a device", roles: ["owner", "manager", "technician", "front_desk"] },
  { href: "/invoices/new", label: "New sale", hint: "Accessories, devices, walk-ins", roles: ["owner", "manager", "front_desk"] },
  { href: "/expenses?add=1", label: "Add expense", hint: "Rent, parts, supplies…", roles: ["owner", "manager"] },
  { href: "/customers/new", label: "New customer", hint: "Add to the customer list", roles: ["owner", "manager", "technician", "front_desk"] },
];

export default function CreateMenu({ role, className = "" }: { role: Role; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className={`${ui.btn} w-full`} aria-expanded={open} aria-haspopup="menu">
        + Create
      </button>
      {open && (
        <div role="menu" className="absolute left-0 z-30 mt-2 w-64 overflow-hidden rounded-xl border border-zinc-200 bg-surface shadow-xl">
          {ITEMS.filter((i) => i.roles.includes(role)).map((i) => (
            <Link key={i.href} href={i.href} role="menuitem" onClick={() => setOpen(false)} className="block px-4 py-2.5 hover:bg-brand-soft">
              <span className="block text-sm font-semibold text-zinc-900">{i.label}</span>
              <span className="block text-xs text-zinc-500">{i.hint}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
