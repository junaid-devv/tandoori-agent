"use client";

import { useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { BarChart3, Building2, ChevronRight, LayoutDashboard, LogOut, Menu, MessageCircle, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Settings2, ShieldCheck, ShoppingBag, UtensilsCrossed, X } from "lucide-react";
import { clsx } from "clsx";
import { useDashboardContext } from "./dashboard/DashboardProvider";
import { useNotifications } from "./dashboard/NotificationHub";

export const workspaceNavigation = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, group: "Workspace", description: "Your restaurant at a glance" },
  { href: "/dashboard/orders", label: "Orders", icon: ShoppingBag, group: "Workspace", description: "Track orders from kitchen to delivery" },
  { href: "/dashboard/conversations", label: "Inbox", icon: MessageSquare, group: "Workspace", description: "Customer conversations and order drafts" },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3, group: "Workspace", description: "Sales, demand and customer insights" },
  { href: "/dashboard/menu", label: "Menu catalog", icon: UtensilsCrossed, group: "Manage", description: "Items, prices and availability" },
  { href: "/dashboard/whatsapp", label: "WhatsApp", icon: MessageCircle, group: "Manage", description: "Connect and manage your business number" },
  { href: "/dashboard/settings", label: "Settings", icon: Settings2, group: "Manage", description: "Hours, delivery and preferences" },
  { href: "/dashboard/clients", label: "Clients", icon: Building2, group: "Platform", description: "Client profiles and onboarding", role: "super_admin" },
  { href: "/dashboard/admin", label: "Administration", icon: ShieldCheck, group: "Platform", description: "Business profile, team and system tools", role: "admin" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { session, profile, logout, isSidebarCollapsed, toggleSidebarCollapsed } = useDashboardContext();
  const { unreadMessagesCount, unseenOrdersCount, hasNewMessageAlert, hasNewOrderAlert } = useNotifications();
  const mobileDialog = useRef<HTMLDialogElement>(null);
  const items = workspaceNavigation.filter(item => !item.role || session.role === "super_admin" || (item.role === "admin" && session.role === "admin"));

  function navigation(compact = false, mobile = false) {
    return <div className={clsx("flex h-full flex-col", compact && "items-center")}>
      <div className={clsx("flex h-[76px] shrink-0 items-center", compact ? "justify-center px-3" : "gap-3 px-6")}>
        <Link href="/dashboard" onClick={() => mobileDialog.current?.close()} aria-label="OrderIQ home" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white"><UtensilsCrossed size={19} strokeWidth={2.2} /></span>
          {!compact && <span className="text-xl font-bold tracking-[-0.8px] text-slate-900">order<span className="text-brand">iq</span><span className="ml-1 text-brand">.</span></span>}
        </Link>
        {mobile && <button className="ml-auto rounded-lg p-2 text-slate-500" aria-label="Close navigation" onClick={() => mobileDialog.current?.close()}><X size={20} /></button>}
      </div>
      {!compact && <div className="mx-4 mb-5 flex items-center gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50 p-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700">
          {profile.logo_url ? <Image src={profile.logo_url} alt="" width={36} height={36} unoptimized className="h-full w-full object-cover" /> : profile.app_name.charAt(0)}
        </div>
        <div className="min-w-0"><p className="truncate text-[13px] font-semibold text-slate-800">{profile.app_name}</p><p className="mt-0.5 text-[11px] text-slate-500">Restaurant workspace</p></div>
      </div>}
      <nav aria-label={mobile ? "Mobile navigation" : "Main navigation"} className="min-h-0 w-full flex-1 overflow-y-auto px-3">
        {["Workspace", "Manage", "Platform"].map(group => {
          const groupItems = items.filter(item => item.group === group);
          if (!groupItems.length) return null;
          return <div key={group} className="mb-6">
            {!compact && <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{group}</p>}
            <div className="space-y-1">{groupItems.map(({ href, label, icon: Icon }) => {
              const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);
              const count = href.endsWith("conversations") ? unreadMessagesCount : href.endsWith("orders") ? unseenOrdersCount : 0;
              const alert = href.endsWith("conversations") ? hasNewMessageAlert : href.endsWith("orders") ? hasNewOrderAlert : false;
              return <Link key={href} href={href} onClick={() => mobileDialog.current?.close()} aria-current={active ? "page" : undefined} title={compact ? label : undefined} data-testid={`nav-${href === "/dashboard" ? "overview" : href.split("/").pop()}`} className={clsx("group relative flex min-h-11 items-center rounded-lg text-[13px] font-medium transition-colors", compact ? "justify-center" : "gap-3 px-3", active ? "bg-orange-50 text-brand" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900")}>
                <Icon size={18} strokeWidth={active ? 2 : 1.7} className="shrink-0" />
                {!compact && <><span className="flex-1">{label}</span>{(count > 0 || alert) ? <span className="flex h-5 min-w-5 items-center justify-center rounded-md bg-brand px-1 text-[10px] font-semibold text-white">{count > 99 ? "99+" : count || "•"}</span> : active && <ChevronRight size={14} />}</>}
                {compact && (count > 0 || alert) && <span className="absolute right-1 top-1.5 h-2 w-2 rounded-full bg-brand" />}
              </Link>;
            })}</div>
          </div>;
        })}
      </nav>
      {!compact && session.role === "super_admin" && <Link href="/dashboard/clients/new" onClick={() => mobileDialog.current?.close()} className="mx-4 mb-5 flex items-center gap-3 rounded-xl border border-dashed border-orange-200 bg-orange-50/40 p-3 text-sm font-medium text-slate-700 hover:bg-orange-50"><span className="rounded-lg bg-white p-1.5 text-brand shadow-xs"><Plus size={17} /></span><span>Add a new client</span></Link>}
      <div className={clsx("w-full border-t border-slate-100", compact ? "p-3" : "p-4")}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{(session.fullName || session.email || "U").slice(0, 2).toUpperCase()}</div>
          {!compact && <><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-800">{session.fullName || session.email || "Team member"}</p><p className="mt-0.5 text-[11px] text-slate-500">{session.role === "super_admin" ? "Platform administrator" : session.role === "admin" ? "Administrator" : "Team member"}</p></div><button onClick={() => void logout()} aria-label="Sign out" title="Sign out" className="rounded-lg p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-700"><LogOut size={16} /></button></>}
        </div>
        {!mobile && <button onClick={toggleSidebarCollapsed} aria-label={compact ? "Expand sidebar" : "Collapse sidebar"} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-[11px] text-slate-500 hover:bg-slate-50 hover:text-slate-700">{compact ? <PanelLeftOpen size={16} /> : <><PanelLeftClose size={15} />Collapse navigation</>}</button>}
      </div>
    </div>;
  }
  return <>
    <aside className={clsx("z-30 hidden h-dvh shrink-0 border-r border-slate-200/80 bg-white transition-[width] duration-200 lg:block", isSidebarCollapsed ? "w-[76px]" : "w-[244px]")}>{navigation(isSidebarCollapsed)}</aside>
    <button onClick={() => mobileDialog.current?.showModal()} className="absolute left-4 top-[19px] z-40 flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 lg:hidden" aria-label="Open navigation"><Menu size={19} /></button>
    <dialog ref={mobileDialog} aria-label="Workspace navigation" className="nav-dialog m-0 h-dvh max-h-none w-[300px] max-w-[90vw] border-r border-slate-200 bg-white p-0 backdrop:bg-slate-950/40" onClick={event => { if (event.target === event.currentTarget && event.clientX > event.currentTarget.getBoundingClientRect().right) event.currentTarget.close(); }}>{navigation(false, true)}</dialog>
  </>;
}
