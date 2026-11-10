import type { Metadata, Viewport } from "next";
// Fonts ship with the app (no download from Google at build time, which failed on Vercel).
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/instrument-sans";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";

// Every page depends on who is signed in, so nothing is pre-rendered at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Deal Portal",
  description: "Auto-finance deals, from first call to closed.",
  appleWebApp: { capable: true, title: "Deals", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F6F8" },
    { media: "(prefers-color-scheme: dark)", color: "#0D0F13" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-CA">
      <body>{children}</body>
    </html>
  );
}
