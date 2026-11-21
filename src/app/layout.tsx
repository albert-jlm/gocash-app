import type { Metadata } from "next";
import "./globals.css";
import { Hanken_Grotesk, Instrument_Sans } from "next/font/google";
import { cn } from "@/lib/utils";

const body = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-body" });
const display = Instrument_Sans({ subsets: ["latin"], variable: "--font-display" });

const THEME_BOOT = `(function(){try{var m=matchMedia("(prefers-color-scheme: dark)");var a=function(){var t=localStorage.getItem("gocash-theme")||"system";var d=t==="dark"||(t==="system"&&m.matches);document.documentElement.classList.toggle("dark",d);var c=document.querySelector('meta[name="theme-color"]');if(c)c.setAttribute("content",d?"#0e1626":"#f5f6f2");};a();m.addEventListener("change",a);}catch(e){}})();`;

export const metadata: Metadata = {
  title: "GoCash",
  description: "Cash-in and cash-out books for the shop",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "GoCash",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn("font-sans", body.variable, display.variable)} suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#f5f6f2" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="bg-[var(--color-background)] text-[var(--color-foreground)] antialiased">
        {children}
      </body>
    </html>
  );
}
