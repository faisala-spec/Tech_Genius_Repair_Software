import { signIn } from "./actions";
import { ui } from "@/lib/ui";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-soft p-4">
      <form action={signIn} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-8 shadow-lg">
        <div className="flex flex-col items-center gap-2">
          <img src="/brand/techgenius-logo.png" alt="Tech Genius" className="h-24 w-auto" />
          <p className={ui.muted}>Sign in to continue</p>
        </div>
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Wrong email or password. Try again.</p>
        )}
        <div>
          <label className={ui.label} htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="username" className={ui.input} />
        </div>
        <div>
          <label className={ui.label} htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" className={ui.input} />
        </div>
        <button className={`${ui.btn} w-full`}>Sign in</button>
      </form>
    </main>
  );
}
