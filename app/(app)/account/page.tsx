import { requireStaff } from "@/lib/session";
import { ui } from "@/lib/ui";
import { changePassword } from "./actions";
import { signOut } from "../../login/actions";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { owner: "Owner", manager: "Manager", technician: "Technician", front_desk: "Front desk" };

const ERRORS: Record<string, string> = {
  short: "The new password needs at least 10 characters.",
  match: "The two new passwords don't match.",
  same: "The new password must be different from the current one.",
  current: "Your current password is not right.",
  weak: "That password is too easy to guess. Try a longer one.",
  failed: "Couldn't change the password. Try again.",
};

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  const { staff, user, shop } = await requireStaff();

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <h1 className={ui.h1}>My account</h1>

      <section className={ui.card}>
        <p className="font-semibold text-zinc-900">{staff.full_name}</p>
        <p className={ui.muted}>
          {ROLE_LABEL[staff.role]} · {shop.name}
        </p>
        <p className={ui.muted}>{user.email}</p>
      </section>

      <form action={changePassword} className={`${ui.card} space-y-4`}>
        <h2 className={ui.h2}>Change password</h2>
        {saved && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Password changed. Use the new one next time you sign in.</p>}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{ERRORS[error] ?? ERRORS.failed}</p>}
        <div>
          <label className={ui.label} htmlFor="current">Current password</label>
          <input id="current" name="current" type="password" required autoComplete="current-password" className={ui.input} />
        </div>
        <div>
          <label className={ui.label} htmlFor="next">New password (at least 10 characters)</label>
          <input id="next" name="next" type="password" required minLength={10} autoComplete="new-password" className={ui.input} />
        </div>
        <div>
          <label className={ui.label} htmlFor="confirm">New password again</label>
          <input id="confirm" name="confirm" type="password" required minLength={10} autoComplete="new-password" className={ui.input} />
        </div>
        <button className={ui.btn}>Change password</button>
      </form>

      <form action={signOut}>
        <button className={ui.btnGhost}>Sign out</button>
      </form>
    </div>
  );
}
