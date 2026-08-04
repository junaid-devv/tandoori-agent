"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  MessageSquare,
  ShoppingBag,
  BarChart3,
  LayoutDashboard,
  UtensilsCrossed,
  Settings,
  LogOut,
  ShieldCheck,
  Users,
} from "lucide-react";
import { clsx } from "clsx";
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";

const baseNavItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/conversations", label: "Conversations", icon: MessageSquare },
  { href: "/dashboard/orders", label: "Orders", icon: ShoppingBag },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/menu", label: "Menu Editor", icon: UtensilsCrossed },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];
const adminNavItems = [...baseNavItems, { href: "/dashboard/admin", label: "Admin", icon: Users }];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { session, profile, selectedBranchId, selectedBranch, setSelectedBranchId, logout } = useDashboardContext();
  const appName = profile.app_name;
  const [firstWord, ...rest] = appName.split(" ");
  const navItems = session.role === "admin" ? adminNavItems : baseNavItems;
  const showBranchPicker = profile.branch_mode === "multiple" || (session.role === "admin" && session.allowedBranches.length > 1);

  const [globalUnreadCount, setGlobalUnreadCount] = useState(0);
  const notifiedSetRef = useRef<Set<string>>(new Set());

  const playNotificationSound = () => {
    try {
      const AudioContextClass = window.AudioContext || ("webkitAudioContext" in window ? window.webkitAudioContext : undefined);
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);

      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } catch (error) {
      console.error("Audio error", error);
    }
  };

  useEffect(() => {
    navItems.forEach((item) => {
      router.prefetch(item.href);
    });
  }, [navItems, router]);

  useEffect(() => {
    const checkNotifications = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const branchQuery = selectedBranchId === "all" ? "" : `&branch_id=${encodeURIComponent(selectedBranchId)}`;
        const res = await fetch(`/api/conversations?limit=30&unread_only=1&lite=1${branchQuery}`, {
          cache: "no-store",
          headers: { "ngrok-skip-browser-warning": "69420" }
        });
        if (!res.ok) return;
        const data = await res.json();

        let currentUnread = 0;
        const currentUnreadIds = new Set<string>();

        for (const conv of data) {
          if (conv.has_unread) {
            currentUnread++;
            currentUnreadIds.add(conv.id);

            if (!notifiedSetRef.current.has(conv.id)) {
              notifiedSetRef.current.add(conv.id);
              playNotificationSound();

              const latestMsg = conv.messages?.[0]?.content || 'New message!';
              toast.message(`New message from ${conv.name || conv.phone}`, {
                description: latestMsg.length > 50 ? latestMsg.slice(0, 50) + '...' : latestMsg
              });
            }
          }
        }

        for (const id of Array.from(notifiedSetRef.current)) {
          if (!currentUnreadIds.has(id)) {
            notifiedSetRef.current.delete(id);
          }
        }
        setGlobalUnreadCount(currentUnread);
      } catch {
        // Silent retry on next polling tick.
      }
    };

    void checkNotifications();
    const interval = window.setInterval(() => void checkNotifications(), 12000);

    return () => {
      window.clearInterval(interval);
    };
  }, [selectedBranchId]);

  const renderBrandMark = (compact = false) => (
    <Link href="/dashboard" className="flex min-w-0 items-center gap-3 group">
      <div className={clsx(
        "flex-shrink-0 overflow-hidden border border-zinc-800 bg-zinc-900 p-0.5 shadow-md shadow-black/40 transition-transform duration-300 group-hover:scale-105 active:scale-95",
        compact ? "h-9 w-9 rounded-lg" : "h-10 w-10 rounded-xl",
      )}>
        {profile.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.logo_url}
            alt={`${appName} logo`}
            className={clsx("h-full w-full object-cover", compact ? "rounded-md" : "rounded-lg")}
          />
        ) : (
          <div className={clsx(
            "flex h-full w-full items-center justify-center bg-brand/10 font-black text-brand",
            compact ? "rounded-md text-xs" : "rounded-lg text-sm",
          )}>
            {appName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className={clsx("truncate font-bold leading-none tracking-tight text-white", compact ? "text-sm" : "text-sm")}>
          {firstWord} <span className="text-brand">{rest.join(" ")}</span>
        </p>
        <p className="mt-1 truncate text-[9px] font-bold uppercase tracking-[0.22em] text-zinc-500">
          Management Hub
        </p>
      </div>
    </Link>
  );

  const renderBranchPicker = (mobile = false) => (
    <label className={clsx("block border border-zinc-800 bg-zinc-900/70", mobile ? "rounded-lg p-1.5" : "rounded-xl p-2.5")}>
      <span className={clsx("mb-1 block font-bold uppercase text-zinc-500", mobile ? "sr-only" : "text-[9px] tracking-[0.2em]")}>
        {showBranchPicker ? "Active Branch" : "Location"}
      </span>
      {showBranchPicker && session.role === "admin" ? (
        <select
          value={selectedBranchId}
          onChange={(event) => setSelectedBranchId(event.target.value as string | "all")}
          className={clsx(
            "w-full rounded-lg border border-zinc-800 bg-zinc-950 text-xs font-medium text-zinc-100 outline-none focus:border-brand",
            mobile ? "px-2 py-1.5" : "px-2.5 py-1.5",
          )}
        >
          <option value="all">All branches</option>
          {session.allowedBranches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
      ) : (
        <div className={clsx("w-full truncate rounded-lg border border-zinc-800 bg-zinc-950 text-xs font-semibold text-zinc-100", mobile ? "px-2 py-1.5" : "px-2.5 py-1.5")}>
          {selectedBranch?.name || session.allowedBranches[0]?.name || profile.app_name}
        </div>
      )}
      {!mobile && (
        <p className="mt-1.5 line-clamp-2 text-[11px] text-zinc-500">
          {!showBranchPicker
            ? selectedBranch?.address || "Branch assigned by admin"
            : selectedBranch
            ? selectedBranch.address
            : session.role === "admin"
              ? "Admin overview across all branches"
              : "Branch is assigned by admin"}
        </p>
      )}
    </label>
  );

  return (
    <>
      <div className="z-30 border-b border-zinc-900 bg-zinc-950 shadow-lg lg:hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(120px,44%)_auto] items-center gap-2 px-3 py-2">
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 text-xs font-black text-brand">
              {profile.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.logo_url}
                  alt={`${appName} logo`}
                  className="h-full w-full rounded-md object-cover"
                />
              ) : (
                <span>{appName.charAt(0).toUpperCase()}</span>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-none text-white">
                {firstWord} <span className="text-brand">{rest.join(" ")}</span>
              </p>
            </div>
          </Link>

          {renderBranchPicker(true)}

          <button
            onClick={() => void logout()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 transition hover:border-zinc-700 hover:text-white"
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-zinc-950/95 px-2 py-1.5 shadow-[0_-12px_30px_rgba(15,23,42,0.16)] backdrop-blur lg:hidden">
        <div className="no-scrollbar flex gap-1 overflow-x-auto">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(href);

            const testIdKey = href === "/dashboard" ? "overview" : href.split("/").pop();
            const shortLabel = label === "Conversations" ? "Chats" : label === "Menu Editor" ? "Menu" : label;
            return (
              <Link
                key={href}
                href={href}
                prefetch
                data-testid={`nav-${testIdKey}`}
                className={clsx(
                  "relative flex min-w-[62px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 py-1.5 text-[9px] font-semibold transition-all",
                  isActive
                    ? "bg-brand text-white"
                    : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200",
                )}
              >
                <Icon size={17} />
                <span className="max-w-full truncate whitespace-nowrap">{shortLabel}</span>
                {href === "/dashboard/conversations" && globalUnreadCount > 0 && (
                  <span className="absolute right-3 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[9px] font-bold text-brand">
                    {globalUnreadCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      <aside className="sticky top-0 z-20 hidden h-dvh w-60 flex-col overflow-hidden border-r border-zinc-900 bg-zinc-950 shadow-2xl lg:flex xl:w-64">
      <div className="border-b border-zinc-800/60 px-4 py-4">
        {renderBrandMark()}
      </div>

      <div className="px-3 pt-3">
        {renderBranchPicker()}
      </div>

      <nav className="no-scrollbar flex-1 space-y-1 overflow-y-auto px-3 py-3">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(href);

          const testIdKey = href === "/dashboard" ? "overview" : href.split("/").pop();
          return (
            <Link
              key={href}
              href={href}
              prefetch
              data-testid={`nav-${testIdKey}`}
              className={clsx(
                "relative flex items-center justify-between overflow-hidden rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all group",
                isActive
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/50"
              )}
            >
              <div className="flex items-center gap-3">
                <Icon
                  size={17}
                  className={clsx(
                    "transition-colors",
                    isActive ? "text-brand" : "text-zinc-500 group-hover:text-zinc-300"
                  )}
                />
                <span className="flex items-center gap-2">
                  {label}
                  {href === "/dashboard/conversations" && globalUnreadCount > 0 && (
                    <span className="rounded-full bg-brand px-1.5 py-0.5 text-[9px] font-bold text-white shadow-sm">
                      {globalUnreadCount}
                    </span>
                  )}
                </span>
              </div>

              {/* Active dot indicator */}
              {isActive && (
                <div className="absolute right-2.5 h-1.5 w-1.5 rounded-full bg-brand shadow-[0_0_8px_rgba(234,88,12,0.6)]" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-zinc-800/70 p-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-2.5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-zinc-300">
              <ShieldCheck size={14} />
            </div>
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold leading-tight text-white">
                {session.fullName || session.email || "Staff User"}
              </p>
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                {session.role === "admin" ? "Admin" : "Branch Staff"}
              </p>
            </div>
          </div>

          <button
            onClick={() => void logout()}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm font-medium text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-900"
          >
            <LogOut size={14} />
            Sign Out
          </button>
        </div>
      </div>
      </aside>
    </>
  );
}
