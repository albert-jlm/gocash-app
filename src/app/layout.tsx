import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { AuthCallbackListener } from "@/components/auth-callback-listener";
import { ShareIntentListener } from "@/components/share-intent-listener";
import { ToastContainer } from "@/components/toast";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "GoCash Tracker",
  description: "Manage your GCash and MariBank transactions",
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.svg",
    apple: "/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
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
    <html lang="en" className={cn("font-sans dark", geist.variable)}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#0a0a0a" />
      </head>
      <body className="min-h-dvh bg-[var(--color-background)] text-[var(--color-foreground)] antialiased">
        <AuthCallbackListener />
        <ShareIntentListener />
        <ToastContainer />
        {children}
      </body>
    </html>
  );
}
