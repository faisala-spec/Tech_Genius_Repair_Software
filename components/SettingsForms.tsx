"use client";

import { useActionState, useState } from "react";
import { updateShop, addCategory, updateAccount, lockBooks, unlockBooks, type FormState } from "@/app/(app)/settings/actions";
import { ui } from "@/lib/ui";

function Msg({ state }: { state: FormState }) {
  if (state?.error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>;
  if (state?.ok) return <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{state.ok}</p>;
  return null;
}

function F({ label, name, v, ...rest }: { label: string; name: string; v?: string | number | null } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className={ui.label} htmlFor={name}>
        {label}
      </label>
      <input id={name} name={name} defaultValue={v ?? ""} className={ui.input} {...rest} />
    </div>
  );
}

export function ShopForm({ shop }: { shop: Record<string, any> }) {
  const [state, action, pending] = useActionState(updateShop, undefined);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="Shop name (on screens)" name="name" v={shop.name} required />
        <F label="Legal name (on invoices)" name="legal_name" v={shop.legal_name} />
        <F label="Phone" name="phone" v={shop.phone} />
        <F label="Email" name="email" v={shop.email} type="email" />
        <F label="Address" name="address" v={shop.address} />
        <div className="grid grid-cols-2 gap-3">
          <F label="City" name="city" v={shop.city} />
          <F label="Province" name="province" v={shop.province} />
        </div>
        <F label="HST registration #" name="tax_number" v={shop.tax_number} />
        <F label="HST rate (%)" name="tax_rate_pct" v={(Number(shop.tax_rate ?? 0.13) * 100).toFixed(2).replace(/\.00$/, "")} inputMode="decimal" />
        <F label="Repair warranty (days)" name="repair_warranty_days" v={shop.repair_warranty_days} inputMode="numeric" />
        <F label="Device warranty (days)" name="device_warranty_days" v={shop.device_warranty_days} inputMode="numeric" />
      </div>
      <div>
        <label className={ui.label} htmlFor="invoice_terms">
          Warranty terms printed on every invoice
        </label>
        <textarea id="invoice_terms" name="invoice_terms" defaultValue={shop.invoice_terms ?? ""} rows={6} className={ui.input} />
      </div>
      <p className="text-xs text-zinc-500">Changing the HST rate affects new invoices only. Invoices already issued keep the rate they were made with.</p>
      <button className={ui.btn} disabled={pending}>
        {pending ? "Saving…" : "Save shop details"}
      </button>
      <Msg state={state} />
    </form>
  );
}

export function AddCategoryForm() {
  const [state, action, pending] = useActionState(addCategory, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="name" required placeholder="New category, e.g. Cleaning" className={`${ui.input} max-w-xs`} />
      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input type="checkbox" name="itc_allowed" defaultChecked className="h-4 w-4 accent-brand" />
        HST can be claimed back
      </label>
      <button className={ui.btnGhost} disabled={pending}>
        Add
      </button>
      <div className="w-full">
        <Msg state={state} />
      </div>
    </form>
  );
}

export function AccountRow({ id, name, active, system }: { id: string; name: string; active: boolean; system: boolean }) {
  const [state, action, pending] = useActionState(updateAccount, undefined);
  const [edit, setEdit] = useState(false);
  if (!edit)
    return (
      <div className="flex items-center justify-between gap-2 py-1.5">
        <span className={active ? "text-zinc-800" : "text-zinc-400 line-through"}>{name}</span>
        <button type="button" onClick={() => setEdit(true)} className="text-xs text-zinc-500 hover:underline">
          Edit
        </button>
      </div>
    );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 py-1.5">
      <input type="hidden" name="account_id" value={id} />
      <input name="name" defaultValue={name} className={`${ui.input} max-w-xs`} />
      {!system && (
        <label className="flex items-center gap-1 text-xs text-zinc-600">
          <input type="checkbox" name="active" defaultChecked={active} className="accent-brand" /> In use
        </label>
      )}
      {system && <input type="hidden" name="active" value="on" />}
      <button className="text-xs font-semibold text-brand-dark" disabled={pending}>
        Save
      </button>
      <button type="button" onClick={() => setEdit(false)} className="text-xs text-zinc-500">
        Cancel
      </button>
      {state?.error && <span className="text-xs text-red-700">{state.error}</span>}
    </form>
  );
}

export function LockForm({ lockedThrough, yesterday }: { lockedThrough: string | null; yesterday: string }) {
  const [state, action, pending] = useActionState(lockBooks, undefined);
  const [ustate, uaction, upending] = useActionState(unlockBooks, undefined);
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-700">
        {lockedThrough ? (
          <>
            Books are locked through <b>{lockedThrough}</b>. Nothing can be added, changed or voided on or before that date.
          </>
        ) : (
          "Books aren't locked yet. Once your accountant has a month, lock it so nothing in it can change."
        )}
      </p>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-zinc-500">
          Lock through
          <input type="date" name="through" max={yesterday} defaultValue={yesterday} className={`${ui.input} mt-1 w-44`} />
        </label>
        <button className={ui.btn} disabled={pending}>
          Lock
        </button>
      </form>
      <Msg state={state} />
      {lockedThrough && (
        <details>
          <summary className="cursor-pointer text-sm text-zinc-500">Unlock (needs a reason; it's recorded)</summary>
          <form action={uaction} className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-xs text-zinc-500">
              New lock date (blank = fully unlocked)
              <input type="date" name="through" className={`${ui.input} mt-1 w-44`} />
            </label>
            <input name="reason" required placeholder="Reason" className={`${ui.input} max-w-xs`} />
            <button className={ui.btnGhost} disabled={upending}>
              Unlock
            </button>
          </form>
          <Msg state={ustate} />
        </details>
      )}
    </div>
  );
}
