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
    <header className="sticky top-0 z-30 flex h-12 w-full items-center justify-between border-b border-slate-200 bg-white/90 px-3 backdrop-blur-md sm:h-16 sm:px-6 lg:px-8">
      {/* Left: Breadcrumbs & Page title */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          <span className="hidden sm:inline">{profile.app_name}</span>
          <ChevronRight size={12} className="hidden sm:inline text-slate-300" />
          <span className="font-bold text-slate-900 truncate text-xs sm:text-sm">{pageInfo.title}</span>
        </div>

        {/* Super Admin: Tenant (Restaurant) Switcher */}
        {session.role === "super_admin" && (
          <div className="relative ml-2 sm:ml-4" ref={restaurantDropdownRef}>
            <button
              onClick={() => setRestaurantDropdownOpen((prev) => !prev)}
              className="flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-1.5 text-xs font-bold text-purple-900 transition hover:bg-purple-100"
              aria-expanded={restaurantDropdownOpen}
              aria-label="Switch restaurant"
            >
              <Building2 size={13} className="text-purple-600 shrink-0" />
              <span className="max-w-[110px] truncate sm:max-w-[170px]">
                {session.availableRestaurants?.find((r) => r.id === session.restaurantId)?.name || "Select Restaurant"}
              </span>
              <ChevronDown size={13} className={clsx("text-purple-500 transition-transform", restaurantDropdownOpen && "rotate-180")} />
            </button>

            {restaurantDropdownOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl ring-1 ring-black/5 animate-in fade-in-0 zoom-in-95 z-50">
                <div className="px-2.5 py-1.5 border-b border-slate-100 mb-1 flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Client Restaurant</p>
                  <span className="text-[9px] font-semibold text-slate-400">{session.availableRestaurants?.length || 0} active</span>
                </div>
                <div className="max-h-60 overflow-y-auto space-y-0.5">
                  {(session.availableRestaurants ?? []).length === 0 ? (
                    <p className="p-3 text-center text-xs text-slate-400">No restaurants created yet.</p>
                  ) : (
                    (session.availableRestaurants ?? []).map((rest) => {
                      const isSelected = rest.id === session.restaurantId;
                      return (
                        <button
                          key={rest.id}
                          onClick={() => void handleSwitchRestaurant(rest.id)}
                          className={clsx(
                            "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition text-left",
                            isSelected ? "bg-purple-50 text-purple-900 font-bold" : "text-slate-700 hover:bg-slate-50"
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold">{rest.name}</p>
                            <p className="truncate text-[10px] text-slate-400">/{rest.slug}</p>
                          </div>
                          {isSelected && <Check size={14} className="text-purple-600 shrink-0 ml-2" />}
                        </button>
                      );
                    })
                  )}
                </div>
                <div className="border-t border-slate-100 mt-1 pt-1">
                  <Link
                    href="/dashboard/admin"
                    onClick={() => setRestaurantDropdownOpen(false)}
                    className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-50 transition"
                  >
                    <span>+ Onboard New Client</span>
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: Sound toggle & User profile */}
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          onClick={() => {
            toggleSoundEnabled();
            toast.message(isSoundEnabled ? "Sounds muted" : "Sounds active");
          }}
          title={isSoundEnabled ? "Mute sounds" : "Unmute sounds"}
          className={clsx(
            "flex h-8 w-8 items-center justify-center rounded-lg border text-xs transition",
            isSoundEnabled
              ? "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 shadow-2xs"
              : "border-amber-200 bg-amber-50 text-amber-700"
          )}
          aria-label={isSoundEnabled ? "Mute sounds" : "Unmute sounds"}
        >
          {isSoundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>

        {/* User Pill */}
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-white">
            {(session.fullName || session.email || "U").charAt(0).toUpperCase()}
          </div>
          <span className="text-xs font-semibold text-slate-800 truncate max-w-[110px]">
            {session.fullName || session.email || "Staff"}
          </span>
          <span className="rounded bg-slate-200/80 px-1 py-0.2 text-[9px] font-bold uppercase text-slate-600">
            {session.role === "super_admin" ? "Super Admin" : session.role === "admin" ? "Admin" : "Staff"}
          </span>
        </div>
      </div>
    </header>
  );
}
