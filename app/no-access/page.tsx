import { signOut } from "../login/actions";
import { ui } from "@/lib/ui";

export default function NoAccess() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className={`${ui.card} max-w-md space-y-4 text-center`}>
        <h1 className={ui.h1}>Almost there</h1>
        <p className={ui.muted}>
          Your login works, but it isn't linked to a staff profile yet. Ask the owner to add you as staff.
        </p>
        <form action={signOut}>
          <button className={ui.btnGhost}>Sign out</button>
        </form>
      </div>
    </main>
  );
}
