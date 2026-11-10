"use client";

import { useEffect } from "react";

export default function PrintButton({ auto = false, label = "Print" }: { auto?: boolean; label?: string }) {
  useEffect(() => {
    if (auto) setTimeout(() => window.print(), 300);
  }, [auto]);
  return (
    <button onClick={() => window.print()} className="no-print fixed right-4 top-4 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow">
      {label}
    </button>
  );
}
