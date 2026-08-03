import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { getRestaurantProfile } from "@/lib/restaurant-profile";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const profile = await getRestaurantProfile();
  return {
    title: `${profile.app_name} - Agent Dashboard`,
    description: `WhatsApp AI ordering agent dashboard for ${profile.app_name}`,
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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <Toaster position="top-right" richColors />
        {children}
      </body>
    </html>
  );
}
