import { ui } from "@/lib/ui";

export default function CustomerForm({ action, c, then }: { action: (f: FormData) => Promise<void>; c?: any; then?: string }) {
  return (
    <form action={action} className={`${ui.card} space-y-4`}>
      {c?.id && <input type="hidden" name="id" value={c.id} />}
      {then && <input type="hidden" name="then" value={then} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="First name" name="first_name" v={c?.first_name} />
        <F label="Last name" name="last_name" v={c?.last_name} />
        <F label="Mobile" name="phone" v={c?.phone} type="tel" />
        <F label="Other phone" name="phone_alt" v={c?.phone_alt} type="tel" />
        <F label="Email" name="email" v={c?.email} type="email" />
        <F label="Company" name="company" v={c?.company} />
        <F label="Address" name="address" v={c?.address} />
        <F label="City" name="city" v={c?.city} />
        <F label="Postal code" name="postal_code" v={c?.postal_code} />
      </div>
      <div>
        <label className={ui.label}>Notes</label>
        <textarea name="notes" rows={3} defaultValue={c?.notes ?? ""} className={ui.input} />
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input type="checkbox" name="sms_consent" defaultChecked={c ? c.sms_consent : true} className="h-4 w-4 accent-brand" />
        Customer agrees to texts about their repairs
      </label>
      <button className={ui.btn}>Save customer</button>
    </form>
  );
}

function F({ label, name, v, type = "text" }: { label: string; name: string; v?: any; type?: string }) {
  return (
    <div>
      <label className={ui.label}>{label}</label>
      <input name={name} type={type} defaultValue={v ?? ""} className={ui.input} />
    </div>
  );
}
