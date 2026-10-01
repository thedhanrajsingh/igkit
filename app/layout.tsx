import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { getBaseUrl } from "@/lib/env";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo";
import "./globals.css";

// NEXTAUTH_URL must be set at build time for absolute OG and canonical URLs.
export const metadata: Metadata = {
  metadataBase: new URL(getBaseUrl()),
  title: {
    default: "IGKit - Open source Instagram comment-to-DM automation",
    template: "%s | IGKit",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US" },
  twitter: { card: "summary_large_image" },
  keywords: [
    "instagram automation",
    "comment to DM",
    "instagram private replies",
    "social commerce",
    "manychat alternative",
    "link in bio",
    "open source",
  ],
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "IGKit",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#18181b",
  width: "device-width",
  initialScale: 1,
  // Installed on iOS the app owns the full screen, notch included; the safe
  // area insets below keep content clear of the system UI.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full dark">
      <body
        className="min-h-full bg-background text-foreground font-sans antialiased"
        // Clears the home indicator when installed; 0 everywhere else.
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {children}
        <Analytics />
      </body>
    </html>
  );
}
