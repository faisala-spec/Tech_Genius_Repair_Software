import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Tech Genius",
  description: "Repairs, sales and customers for Tech Genius",
  icons: { icon: "/brand/techgenius-logo.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#e28e34",
};

// Set light/dark before the first paint so the page never flashes. Printouts are always light.
const THEME_SCRIPT = `try{var t=localStorage.getItem("tg.theme");if(t==="dark"&&!location.pathname.startsWith("/print"))document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
