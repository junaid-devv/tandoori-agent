"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, Check, ChevronDown, ChevronRight, Loader2, Search, Volume2, VolumeX, X } from "lucide-react";
import { toast } from "sonner";
import { useDashboardContext } from "./dashboard/DashboardProvider";
import { workspaceNavigation } from "./Sidebar";

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { session, profile, isSoundEnabled, toggleSoundEnabled } = useDashboardContext();
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [search, setSearch] = useState("");
  const [switching, setSwitching] = useState<string | null>(null);
  const dropdown = useRef<HTMLDivElement>(null);
  const command = useRef<HTMLDialogElement>(null);
  const items = workspaceNavigation.filter(item => !item.role || session.role === "super_admin" || (item.role === "admin" && session.role === "admin"));
  const currentPage = [...items].reverse().find(item => pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href)));

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setWorkspaceOpen(false);
      if ((event.ctrlKey || event.metaKey) && event.key === "k") {
        event.preventDefault();
        setSearch("");
        command.current?.showModal();
      }
    }
    function onClick(event: MouseEvent) {
      if (!dropdown.current?.contains(event.target as Node)) setWorkspaceOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, []);

  async function switchWorkspace(id: string) {
    if (switching || id === session.restaurantId) return;
    setSwitching(id);
    try {
      const response = await fetch("/api/admin/switch-restaurant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurantId: id }) });
      if (!response.ok) throw new Error("Could not switch workspace. Please try again.");
      window.location.assign("/dashboard");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not switch workspace."); setSwitching(null); }
  }

  const results = items.filter(item => `${item.label} ${item.description}`.toLowerCase().includes(search.toLowerCase()));
  return <header className="relative z-30 flex h-[76px] shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-white px-5 pl-16 sm:px-7 sm:pl-16 lg:pl-7 xl:px-10">
    <div className="flex min-w-0 items-center gap-2 text-xs"><span className="hidden text-slate-500 sm:inline">Workspace</span><ChevronRight size={13} className="hidden text-slate-300 sm:block" /><span className="truncate font-medium text-slate-700">{currentPage?.label || "Dashboard"}</span>{pathname.endsWith("/new") && <><ChevronRight size={13} className="text-slate-300" /><span className="text-slate-500">New client</span></>}</div>
    <div className="flex min-w-0 items-center gap-2 sm:gap-4">
      <button onClick={() => { setSearch(""); command.current?.showModal(); }} aria-label="Search pages" className="flex h-9 items-center gap-2 rounded-lg px-2 text-slate-500 transition hover:bg-slate-50 sm:border sm:border-slate-200 sm:pr-2.5"><Search size={16} /><span className="hidden text-xs xl:inline">Go to a page...</span><kbd className="ml-5 hidden rounded border border-slate-200 px-1 py-0.5 text-[10px] sm:block">Ctrl K</kbd></button>
      <div className="hidden h-5 w-px bg-slate-200 sm:block" />
      <div className="relative min-w-0" ref={dropdown}>
        {session.role === "super_admin" ? <>
          <button onClick={() => setWorkspaceOpen(!workspaceOpen)} aria-expanded={workspaceOpen} aria-controls="workspace-menu" className="flex h-9 max-w-[180px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:max-w-[220px]"><Building2 size={15} className="shrink-0 text-slate-500" /><span className="truncate">{session.availableRestaurants?.find(item => item.id === session.restaurantId)?.name || profile.app_name}</span><ChevronDown size={13} className="shrink-0 text-slate-500" /></button>
          {workspaceOpen && <div id="workspace-menu" className="absolute right-0 top-full z-50 mt-2 w-[min(310px,85vw)] rounded-xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10">
            <p className="px-2 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Switch client workspace</p>
            <input autoFocus aria-label="Find a client workspace" value={workspaceSearch} onChange={event => setWorkspaceSearch(event.target.value)} placeholder="Find a client..." className="ui-input mb-2" />
            <div className="max-h-64 overflow-y-auto">{(session.availableRestaurants || []).filter(item => item.name.toLowerCase().includes(workspaceSearch.toLowerCase())).map(item => <button key={item.id} disabled={!!switching} onClick={() => void switchWorkspace(item.id)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"><span className="truncate">{item.name}</span>{switching === item.id ? <Loader2 size={14} className="animate-spin" /> : session.restaurantId === item.id && <Check size={15} className="shrink-0 text-brand" />}</button>)}{!(session.availableRestaurants || []).some(item => item.name.toLowerCase().includes(workspaceSearch.toLowerCase())) && <p className="p-3 text-xs text-slate-500">No clients found.</p>}</div>
            <Link href="/dashboard/clients" onClick={() => setWorkspaceOpen(false)} className="mt-2 flex items-center justify-between border-t border-slate-100 px-3 pt-3 pb-1 text-xs font-medium text-brand">Manage all clients<ChevronRight size={14} /></Link>
          </div>}
        </> : <span className="hidden max-w-48 truncate text-xs font-medium text-slate-600 sm:block">{profile.app_name}</span>}
      </div>
      <button onClick={() => { toggleSoundEnabled(); toast.message(isSoundEnabled ? "Notification sounds muted" : "Notification sounds enabled"); }} aria-label={isSoundEnabled ? "Mute notification sounds" : "Enable notification sounds"} aria-pressed={isSoundEnabled} className="hidden h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 hover:text-slate-700 sm:flex">{isSoundEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}</button>
    </div>
    <dialog ref={command} aria-labelledby="command-title" className="command-dialog fixed top-[15vh] mx-auto w-[min(560px,calc(100%-32px))] rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-950/30" onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close(); } }}>
      <div className="flex items-center gap-3 border-b border-slate-100 p-4"><Search size={18} className="text-slate-500" /><h2 id="command-title" className="sr-only">Search pages</h2><input autoFocus value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && results[0]) { command.current?.close(); router.push(results[0].href); } }} placeholder="Where would you like to go?" aria-label="Search pages" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /><button onClick={() => command.current?.close()} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close search"><X size={17} /></button></div>
      <div className="max-h-[55vh] overflow-y-auto p-2">{results.map(({ href, label, description, icon: Icon }) => <Link key={href} href={href} onClick={() => command.current?.close()} className="flex items-center gap-3 rounded-xl p-3 hover:bg-slate-50"><span className="rounded-lg border border-slate-200 p-2 text-slate-500"><Icon size={18} /></span><div><p className="text-sm font-medium text-slate-800">{label}</p><p className="mt-0.5 text-xs text-slate-500">{description}</p></div><ChevronRight size={14} className="ml-auto text-slate-300" /></Link>)}{results.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No matching pages. Try “orders” or “settings”.</p>}</div>
    </dialog>
  </header>;
}
