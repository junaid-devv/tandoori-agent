import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { getRestaurantProfile } from "@/lib/restaurant-profile";
import { PwaRegister } from "@/app/components/PwaRegister";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateViewport(): Promise<Viewport> {
  const profile = await getRestaurantProfile();
  return {
    themeColor: profile.brand_color || "#EA580C",
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const profile = await getRestaurantProfile();
  return {
    title: `${profile.app_name} - Agent Dashboard`,
    description: `WhatsApp AI ordering agent dashboard for ${profile.app_name}`,
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: profile.app_name,
    },
    icons: {
      icon: [
        { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: [
        { url: "/apple-touch-icon.png", sizes: "180x180" },
      ],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const profile = await getRestaurantProfile();
  const rootStyle = {
    "--brand": profile.brand_color,
    "--brand-hover": profile.brand_hover_color,
  } as CSSProperties & Record<"--brand" | "--brand-hover", string>;

  return (
    <html lang="en" suppressHydrationWarning style={rootStyle}>
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <PwaRegister />
        <Toaster position="bottom-center" richColors />
        {children}
      </body>
    </html>
  );
}
