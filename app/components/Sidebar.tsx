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
  PanelLeftClose,
  PanelLeftOpen,
  MessageCircle,
} from "lucide-react";
import { clsx } from "clsx";
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";
import { useNotifications } from "@/app/components/dashboard/NotificationHub";

const baseNavItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/conversations", label: "Conversations", icon: MessageSquare },
  { href: "/dashboard/orders", label: "Orders", icon: ShoppingBag },
  { href: "/dashboard/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/menu", label: "Menu", icon: UtensilsCrossed },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];
const adminNavItems = [...baseNavItems, { href: "/dashboard/admin", label: "Admin", icon: Users }];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    session,
    profile,
    logout,
    isSidebarCollapsed,
    toggleSidebarCollapsed,
  } = useDashboardContext();

  const {
    unreadMessagesCount,
    unseenOrdersCount,
    hasNewOrderAlert,
    hasNewMessageAlert,
  } = useNotifications();

  const appName = profile.app_name;
  const [firstWord, ...rest] = appName.split(" ");
  const navItems = (session.role === "admin" || session.role === "super_admin") ? adminNavItems : baseNavItems;

  useEffect(() => {
    navItems.forEach((item) => {
      router.prefetch(item.href);
    });
  }, [navItems, router]);

  const renderBrandMark = (compact = false) => (
    <Link href="/dashboard" className={clsx("flex min-w-0 items-center group", compact ? "justify-center" : "gap-2.5")}>
      <div className={clsx(
        "flex-shrink-0 overflow-hidden border border-zinc-800 bg-zinc-900 p-0.5 shadow-md shadow-black/40 transition-transform duration-300 group-hover:scale-105 active:scale-95",
        compact ? "h-8 w-8 rounded-lg" : "h-9 w-9 rounded-lg",
      )}>
        {profile.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.logo_url}
            alt={`${appName} logo`}
            className="h-full w-full rounded-md object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-brand/10 font-black text-brand rounded-md text-sm">
            {appName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      {!compact && (
        <div className="min-w-0">
          <p className="truncate font-bold leading-none tracking-tight text-white text-sm">
            {firstWord} <span className="text-brand">{rest.join(" ")}</span>
          </p>
          <p className="mt-0.5 truncate text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
            Management Hub
          </p>
        </div>
      )}
    </Link>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="z-30 border-b border-zinc-900 bg-zinc-950 shadow-lg lg:hidden">
        <div className="flex items-center justify-between px-3 py-2">
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 text-xs font-black text-brand">
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
            <p className="truncate text-sm font-bold leading-none text-white">
              {firstWord} <span className="text-brand">{rest.join(" ")}</span>
            </p>
          </Link>

          <button
            onClick={() => void logout()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 transition hover:border-zinc-700 hover:text-white"
            aria-label="Sign out"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800/80 bg-zinc-950/95 px-1 py-1 pb-[calc(env(safe-area-inset-bottom,0px)+0.25rem)] shadow-[0_-10px_25px_rgba(0,0,0,0.5)] backdrop-blur lg:hidden">
        <div className="no-scrollbar flex items-center justify-around gap-0.5 overflow-x-auto px-0.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(href);

            const testIdKey = href === "/dashboard" ? "overview" : href.split("/").pop();
            const shortLabel = label === "Conversations" ? "Chats" : label;
            return (
              <Link
                key={href}
                href={href}
                prefetch
                data-testid={`nav-${testIdKey}`}
                className={clsx(
                  "relative flex min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 px-0.5 transition-all duration-150",
                  isActive
                    ? "bg-brand/15 text-brand font-bold"
                    : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200",
                )}
              >
                <div className="relative">
                  <Icon size={17} className={clsx("transition-colors", isActive ? "text-brand" : "text-zinc-400")} />
                  {href === "/dashboard/conversations" && (unreadMessagesCount > 0 || hasNewMessageAlert) && (
                    <span
                      className={clsx(
                        "absolute -top-1 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[8px] font-black text-white ring-1 ring-zinc-950",
                        hasNewMessageAlert ? "bg-red-500 animate-bounce" : "bg-brand"
                      )}
                    >
                      {unreadMessagesCount > 0 ? unreadMessagesCount : "!"}
                    </span>
                  )}
                  {href === "/dashboard/orders" && (unseenOrdersCount > 0 || hasNewOrderAlert) && (
                    <span
                      className={clsx(
                        "absolute -top-1 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[8px] font-black text-white ring-1 ring-zinc-950",
                        hasNewOrderAlert ? "bg-amber-500 animate-bounce" : "bg-zinc-700"
                      )}
                    >
                      {unseenOrdersCount > 0 ? unseenOrdersCount : "!"}
                    </span>
                  )}
                </div>
                <span className="max-w-full truncate text-[9px] leading-tight tracking-tight">{shortLabel}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Desktop Sidebar (Collapsible) */}
      <aside
        className={clsx(
          "sticky top-0 z-20 hidden h-dvh flex-col overflow-hidden border-r border-zinc-900 bg-zinc-950 shadow-2xl transition-all duration-300 ease-in-out lg:flex",
          isSidebarCollapsed ? "w-14" : "w-56 xl:w-60"
        )}
      >
        {/* Brand Header */}
        <div className={clsx("border-b border-zinc-800/60 transition-all", isSidebarCollapsed ? "p-2.5 flex justify-center" : "px-3 py-3")}>
          {renderBrandMark(isSidebarCollapsed)}
        </div>

        {/* Navigation Items */}
        <nav className="no-scrollbar flex-1 space-y-0.5 overflow-y-auto p-1.5">
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
                title={isSidebarCollapsed ? label : undefined}
                className={clsx(
                  "group relative flex items-center overflow-hidden rounded-lg text-[13px] font-medium transition-all",
                  isSidebarCollapsed ? "h-9 w-9 mx-auto justify-center" : "px-2.5 py-2 justify-between",
                  isActive
                    ? "bg-zinc-900 text-white shadow-inner"
                    : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/50"
                )}
              >
                <div className={clsx("flex items-center", isSidebarCollapsed ? "justify-center" : "gap-2.5")}>
                  <Icon
                    size={16}
                    className={clsx(
                      "transition-colors shrink-0",
                      isActive ? "text-brand" : "text-zinc-500 group-hover:text-zinc-300"
                    )}
                  />
                  {!isSidebarCollapsed && (
                    <span className="flex items-center gap-1.5 truncate text-[13px]">
                      {label}
                      {href === "/dashboard/conversations" && (unreadMessagesCount > 0 || hasNewMessageAlert) && (
                        <span
                          className={clsx(
                            "rounded-full px-1 py-0.5 text-[9px] font-bold text-white",
                            hasNewMessageAlert ? "bg-red-500 animate-pulse" : "bg-brand"
                          )}
                        >
                          {unreadMessagesCount > 0 ? unreadMessagesCount : "•"}
                        </span>
                      )}
                      {href === "/dashboard/orders" && (unseenOrdersCount > 0 || hasNewOrderAlert) && (
                        <span
                          className={clsx(
                            "rounded-full px-1 py-0.5 text-[9px] font-bold text-white",
                            hasNewOrderAlert ? "bg-amber-500 animate-bounce" : "bg-zinc-700"
                          )}
                        >
                          {unseenOrdersCount > 0 ? unseenOrdersCount : "•"}
                        </span>
                      )}
                    </span>
                  )}
                </div>

                {/* Collapsed badge dots */}
                {isSidebarCollapsed && href === "/dashboard/conversations" && (unreadMessagesCount > 0 || hasNewMessageAlert) && (
                  <span
                    className={clsx(
                      "absolute top-1 right-1 h-2 w-2 rounded-full ring-1 ring-zinc-950",
                      hasNewMessageAlert ? "bg-red-500 animate-ping" : "bg-brand animate-pulse"
                    )}
                  />
                )}
                {isSidebarCollapsed && href === "/dashboard/orders" && (unseenOrdersCount > 0 || hasNewOrderAlert) && (
                  <span
                    className={clsx(
                      "absolute top-1 right-1 h-2 w-2 rounded-full ring-1 ring-zinc-950",
                      hasNewOrderAlert ? "bg-amber-500 animate-ping" : "bg-amber-600 animate-pulse"
                    )}
                  />
                )}

                {/* Active indicator */}
                {isActive && !isSidebarCollapsed && (
                  <div className="absolute right-2 h-1.5 w-1.5 rounded-full bg-brand shadow-[0_0_6px_rgba(234,88,12,0.6)]" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer: User + Collapse */}
        <div className="border-t border-zinc-800/70 p-1.5 space-y-1.5">
          <div className={clsx("rounded-lg border border-zinc-800 bg-zinc-900/70", isSidebarCollapsed ? "p-1.5 flex justify-center" : "p-2")}>
            {isSidebarCollapsed ? (
              <button
                onClick={() => void logout()}
                title={`Sign out (${session.fullName || session.email})`}
                className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-800 text-zinc-300 hover:text-white transition hover:bg-zinc-700"
              >
                <LogOut size={14} />
              </button>
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-zinc-300">
                    <ShieldCheck size={12} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold leading-tight text-white">
                      {session.fullName || session.email || "Staff User"}
                    </p>
                    <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-500">
                      {session.role === "super_admin" ? "Super Admin" : session.role === "admin" ? "Admin" : "Branch Staff"}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => void logout()}
                  className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] font-medium text-zinc-400 transition hover:border-zinc-700 hover:bg-zinc-900"
                >
                  <LogOut size={11} />
                  Sign Out
                </button>
              </div>
            )}
          </div>

          <button
            onClick={toggleSidebarCollapsed}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-zinc-800/80 bg-zinc-900/40 p-1.5 text-[11px] font-medium text-zinc-500 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-300 transition-all"
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen size={14} />
            ) : (
              <>
                <PanelLeftClose size={13} />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}

