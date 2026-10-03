"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Check,
  Volume2,
  VolumeX,
} from "lucide-react";
import { clsx } from "clsx";
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";
import { useNotifications } from "@/app/components/dashboard/NotificationHub";
import { toast } from "sonner";

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": { title: "Overview", subtitle: "Live restaurant performance & fulfillment" },
  "/dashboard/conversations": { title: "Conversations", subtitle: "Customer WhatsApp chats & order drafts" },
  "/dashboard/orders": { title: "Orders Queue", subtitle: "Live incoming, active & fulfilled orders" },
  "/dashboard/analytics": { title: "Analytics", subtitle: "Demand trends, revenue & top selling items" },
  "/dashboard/menu": { title: "Menu Catalog", subtitle: "Menu items, pricing & AI photo digitizer" },
  "/dashboard/settings": { title: "Settings", subtitle: "Store hours, delivery rules & AI personality" },
  "/dashboard/admin": { title: "Admin Console", subtitle: "Staff access & system diagnostics" },
};

export function Header() {
  const pathname = usePathname();
  const { session, profile, isSoundEnabled, toggleSoundEnabled } = useDashboardContext();

  // useNotifications is still needed for the notification hub side-effect
  useNotifications();

  const [restaurantDropdownOpen, setRestaurantDropdownOpen] = useState(false);
  const restaurantDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (restaurantDropdownRef.current && !restaurantDropdownRef.current.contains(event.target as Node)) {
        setRestaurantDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleSwitchRestaurant(restaurantId: string) {
    try {
      const res = await fetch("/api/admin/switch-restaurant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId }),
      });
      if (!res.ok) throw new Error("Failed to switch restaurant");
      window.location.reload();
    } catch {
      toast.error("Failed to switch restaurant.");
    }
  }

  const pageInfo = PAGE_TITLES[pathname] || {
    title: pathname.split("/").pop()?.replace(/^\w/, (c) => c.toUpperCase()) || "Dashboard",
    subtitle: "Management Console",
  };

  return (
    <header className="sticky top-0 z-30 flex h-11 w-full items-center gap-2 border-b border-slate-200 bg-white/95 px-3 backdrop-blur-sm sm:px-4 lg:px-6">
      {/* Left: Breadcrumb + Restaurant Switcher */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">{profile.app_name}</span>
        <ChevronRight size={12} className="hidden shrink-0 text-slate-300 sm:inline" />
        <span className="truncate text-xs font-semibold text-slate-800">{pageInfo.title}</span>

        {/* Super Admin Restaurant Switcher */}
        {session.role === "super_admin" && (
          <div className="relative ml-1 shrink-0" ref={restaurantDropdownRef}>
            <button
              onClick={() => setRestaurantDropdownOpen((prev) => !prev)}
              className="flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-800 transition hover:bg-purple-100"
              aria-expanded={restaurantDropdownOpen}
            >
              <Building2 size={11} className="shrink-0 text-purple-500" />
              <span className="max-w-[90px] truncate sm:max-w-[130px]">
                {session.availableRestaurants?.find((r) => r.id === session.restaurantId)?.name ?? "Select"}
              </span>
              <ChevronDown
                size={11}
                className={clsx("shrink-0 text-purple-400 transition-transform", restaurantDropdownOpen && "rotate-180")}
              />
            </button>

            {restaurantDropdownOpen && (
              <div className="absolute left-0 top-full mt-1 w-52 rounded-xl border border-slate-200 bg-white p-1 shadow-xl ring-1 ring-black/5 z-50">
                <p className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                  Switch Restaurant
                </p>
                <div className="max-h-48 overflow-y-auto">
                  {(session.availableRestaurants ?? []).map((rest) => {
                    const isSelected = rest.id === session.restaurantId;
                    return (
                      <button
                        key={rest.id}
                        onClick={() => void handleSwitchRestaurant(rest.id)}
                        className={clsx(
                          "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition text-left",
                          isSelected ? "bg-purple-50 font-semibold text-purple-900" : "text-slate-700 hover:bg-slate-50"
                        )}
                      >
                        <span className="truncate">{rest.name}</span>
                        {isSelected && <Check size={12} className="shrink-0 text-purple-600" />}
                      </button>
                    );
                  })}
                </div>
                <div className="border-t border-slate-100 mt-1 pt-1">
                  <Link
                    href="/dashboard/admin"
                    onClick={() => setRestaurantDropdownOpen(false)}
                    className="flex w-full items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-purple-700 hover:bg-purple-50 transition"
                  >
                    + Onboard New Client
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: Sound + User pill */}
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          onClick={() => {
            toggleSoundEnabled();
            toast.message(isSoundEnabled ? "Sounds muted" : "Sounds active");
          }}
          title={isSoundEnabled ? "Mute sounds" : "Unmute sounds"}
          className={clsx(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition",
            isSoundEnabled
              ? "border-slate-200 bg-white text-slate-500 hover:text-slate-800"
              : "border-amber-200 bg-amber-50 text-amber-600"
          )}
          aria-label={isSoundEnabled ? "Mute sounds" : "Unmute sounds"}
        >
          {isSoundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
        </button>

        {/* User Pill */}
        <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-white">
            {(session.fullName || session.email || "U").charAt(0).toUpperCase()}
          </div>
          <span className="hidden max-w-[90px] truncate text-[11px] font-semibold text-slate-700 sm:block">
            {session.fullName || session.email || "Staff"}
          </span>
          <span className="rounded bg-slate-200 px-1 py-0.5 text-[9px] font-bold uppercase text-slate-500">
            {session.role === "super_admin" ? "SA" : session.role === "admin" ? "Admin" : "Staff"}
          </span>
        </div>
      </div>
    </header>
  );
}
