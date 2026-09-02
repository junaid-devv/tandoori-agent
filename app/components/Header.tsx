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
  Zap, 
  Bot, 
  Sparkles,
  Search,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { clsx } from "clsx";
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";
import { toast } from "sonner";

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": { title: "Overview", subtitle: "Live restaurant performance & fulfillment" },
  "/dashboard/conversations": { title: "Conversations", subtitle: "Customer WhatsApp chats & order drafts" },
  "/dashboard/orders": { title: "Orders Queue", subtitle: "Live incoming, active & fulfilled orders" },
  "/dashboard/analytics": { title: "Analytics", subtitle: "Demand trends, revenue & top selling items" },
  "/dashboard/menu": { title: "Menu Catalog", subtitle: "Menu items, pricing & AI photo digitizer" },
  "/dashboard/settings": { title: "Settings", subtitle: "Store hours, delivery rules & AI personality" },
  "/dashboard/admin": { title: "Admin Console", subtitle: "Branches, staff access & system diagnostics" },
};

export function Header() {
  const pathname = usePathname();
  const {
    session,
    profile,
    selectedBranchId,
    selectedBranch,
    setSelectedBranchId,
    isSoundEnabled,
    toggleSoundEnabled,
  } = useDashboardContext();

  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setBranchDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const pageInfo = PAGE_TITLES[pathname] || {
    title: pathname.split("/").pop()?.replace(/^\w/, (c) => c.toUpperCase()) || "Dashboard",
    subtitle: "Management Console",
  };

  const showBranchPicker =
    profile.branch_mode === "multiple" ||
    (session.role === "admin" && session.allowedBranches.length > 1) ||
    session.allowedBranches.length > 1;

  return (
    <header className="sticky top-0 z-30 flex h-12 w-full items-center justify-between border-b border-slate-200 bg-white/90 px-3 backdrop-blur-md sm:h-16 sm:px-6 lg:px-8">
      {/* Left: Breadcrumbs & Page title */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          <span className="hidden sm:inline">OrderIQ</span>
          <ChevronRight size={12} className="hidden sm:inline text-slate-300" />
          <span className="font-bold text-slate-900 truncate text-xs sm:text-sm">{pageInfo.title}</span>
        </div>

        {/* Universal Branch Selector */}
        {showBranchPicker && (
          <div className="relative ml-2 sm:ml-4" ref={dropdownRef}>
            <button
              onClick={() => setBranchDropdownOpen((prev) => !prev)}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 transition hover:border-slate-300 hover:bg-slate-100"
              aria-expanded={branchDropdownOpen}
              aria-label="Select branch"
            >
              <Building2 size={13} className="text-brand shrink-0" />
              <span className="max-w-[120px] truncate sm:max-w-[180px]">
                {selectedBranchId === "all" ? "All Branches" : (selectedBranch?.name || "Select Branch")}
              </span>
              <ChevronDown size={13} className={clsx("text-slate-400 transition-transform", branchDropdownOpen && "rotate-180")} />
            </button>

            {/* Branch Selector Dropdown */}
            {branchDropdownOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl ring-1 ring-black/5 animate-in fade-in-0 zoom-in-95 z-50">
                <div className="px-2.5 py-1.5 border-b border-slate-100 mb-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Select Location</p>
                </div>

                {session.role === "admin" && (
                  <button
                    onClick={() => {
                      setSelectedBranchId("all");
                      setBranchDropdownOpen(false);
                      toast.info("Switched view to All Branches");
                    }}
                    className={clsx(
                      "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition",
                      selectedBranchId === "all"
                        ? "bg-brand/10 text-brand font-bold"
                        : "text-slate-700 hover:bg-slate-50"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Building2 size={14} className={selectedBranchId === "all" ? "text-brand" : "text-slate-400"} />
                      <span>All Accessible Branches</span>
                    </div>
                    {selectedBranchId === "all" && <Check size={14} className="text-brand" />}
                  </button>
                )}

                <div className="max-h-56 overflow-y-auto space-y-0.5 mt-0.5">
                  {session.allowedBranches.map((branch) => {
                    const isSelected = selectedBranchId === branch.id;
                    return (
                      <button
                        key={branch.id}
                        onClick={() => {
                          setSelectedBranchId(branch.id);
                          setBranchDropdownOpen(false);
                          toast.success(`Switched branch to ${branch.name}`);
                        }}
                        className={clsx(
                          "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs transition",
                          isSelected
                            ? "bg-brand/10 text-brand font-bold"
                            : "text-slate-700 hover:bg-slate-50"
                        )}
                      >
                        <div className="min-w-0 text-left">
                          <p className="truncate font-semibold">{branch.name}</p>
                          <p className="truncate text-[10px] text-slate-400">{branch.address || branch.slug}</p>
                        </div>
                        {isSelected && <Check size={14} className="text-brand shrink-0 ml-2" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: Realtime status badges, Audio toggle & User profile */}
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Realtime AI Status Pill */}
        <div className="hidden sm:flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/80 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span>AI Agent Live</span>
        </div>

        {/* Sound Notifications Toggle Button */}
        <button
          onClick={() => {
            toggleSoundEnabled();
            toast.message(isSoundEnabled ? "Sound notifications muted" : "Sound notifications unmuted");
          }}
          title={isSoundEnabled ? "Mute notification sounds" : "Unmute notification sounds"}
          className={clsx(
            "flex h-8 w-8 items-center justify-center rounded-lg border text-xs transition",
            isSoundEnabled
              ? "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              : "border-amber-200 bg-amber-50 text-amber-700"
          )}
          aria-label={isSoundEnabled ? "Mute sounds" : "Unmute sounds"}
        >
          {isSoundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>

        {/* Settings Quick Shortcut */}
        <Link
          href="/dashboard/settings"
          title="Store Settings"
          className="hidden sm:flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
        >
          <Settings size={15} />
        </Link>

        {/* User Pill */}
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
            {(session.fullName || session.email || "U").charAt(0).toUpperCase()}
          </div>
          <span className="hidden md:inline text-xs font-semibold text-slate-800 truncate max-w-[100px]">
            {session.fullName || session.email || "Staff"}
          </span>
          <span className="rounded bg-slate-200/70 px-1 py-0.2 text-[9px] font-bold uppercase text-slate-600">
            {session.role === "admin" ? "Admin" : "Staff"}
          </span>
        </div>
      </div>
    </header>
  );
}

