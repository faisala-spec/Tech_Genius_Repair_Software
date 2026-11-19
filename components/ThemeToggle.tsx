"use client";

// Light / dark switch. Remembered per browser; the first paint is set by the script in app/layout.tsx.
import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const flip = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("tg.theme", next ? "dark" : "light");
    } catch {}
  };
  return (
    <button type="button" onClick={flip} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100" aria-pressed={dark}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {dark ? <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z" /> : <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />}
      </svg>
      {dark ? "Light mode" : "Dark mode"}
    </button>
  );
}
