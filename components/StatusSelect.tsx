"use client";

import { useTransition } from "react";
import { STATUSES } from "@/lib/format";
import { setStatus } from "@/app/(app)/tickets/actions";

export default function StatusSelect({ ticketId, status }: { ticketId: string; status: string }) {
  const [pending, start] = useTransition();
  return (
    <select
      defaultValue={status}
      disabled={pending}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const fd = new FormData();
        fd.set("ticket_id", ticketId);
        fd.set("status", e.target.value);
        start(() => setStatus(fd));
      }}
      className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700 disabled:opacity-50"
    >
      {STATUSES.map((s) => (
        <option key={s.key} value={s.key}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
