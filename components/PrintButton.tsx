"use client";

import { useEffect } from "react";
import { ui } from "@/lib/ui";

/** Print the page. `auto` prints as soon as it opens (labels); `inline` sits in the page instead of the corner. */
export default function PrintButton({ auto = false, label = "Print", inline = false }: { auto?: boolean; label?: string; inline?: boolean }) {
  useEffect(() => {
    if (auto) setTimeout(() => window.print(), 300);
  }, [auto]);
  if (inline)
    return (
      <button type="button" onClick={() => window.print()} className={`${ui.btnGhost} no-print`}>
        {label}
      </button>
    );
  return (
    <button onClick={() => window.print()} className="no-print fixed right-4 top-4 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow">
      {label}
    </button>
  );
}
