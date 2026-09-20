import type { MetadataRoute } from "next";
import { getRestaurantProfile } from "@/lib/restaurant-profile";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const profile = await getRestaurantProfile();
  return {
    name: `${profile.app_name} — Management Hub`,
    short_name: profile.app_name,
    description: `AI WhatsApp ordering dashboard for ${profile.app_name}`,
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: profile.brand_color || "#EA580C",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
