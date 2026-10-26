"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Check, ChevronRight, GitBranch, Loader2, MapPin, Plus, RefreshCw, Search } from "lucide-react";
import { clsx } from "clsx";
import { toast } from "sonner";
import { PageHeader } from "./PageHeader";
import { EmptyState, ErrorNotice } from "./WorkspaceUI";
import { useDashboardContext } from "./DashboardProvider";
import { useDataCache } from "@/lib/useDataCache";

type Client = { id: string; name: string; slug: string; city: string; brand_color: string; is_active: boolean; created_at: string; branches: { id: string; name: string; is_active: boolean }[]; whatsapp_configs: { id: string; is_active: boolean }[] };

export function ClientDirectory() {
  const { session } = useDashboardContext();
  const { data, error, isLoading, isRevalidating, revalidate } = useDataCache<Client[]>("/api/admin/restaurants");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [switching, setSwitching] = useState<string | null>(null);
  const clients = data || [];
  const active = clients.filter(client => client.is_active).length;
  const branches = clients.reduce((sum, client) => sum + (client.branches?.length || 0), 0);
  const filtered = useMemo(() => (data || []).filter(client => `${client.name} ${client.city} ${client.slug}`.toLowerCase().includes(query.toLowerCase()) && (filter === "all" || (filter === "active" ? client.is_active : !client.is_active))), [data, query, filter]);

  async function openClient(id: string) {
    if (id === session.restaurantId) { window.location.assign("/dashboard"); return; }
    setSwitching(id);
    try {
      const response = await fetch("/api/admin/switch-restaurant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurantId: id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not open this client workspace.");
      window.location.assign("/dashboard");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not switch workspace."); setSwitching(null); }
  }

  return <div className="space-y-7 pb-6">
    <PageHeader eyebrow="Platform" title="Clients" description="Every restaurant, one organized workspace. Manage your clients and welcome new ones." actions={<Link href="/dashboard/clients/new" className="ui-button ui-button-primary"><Plus size={16} />New client</Link>} />
    {error && <ErrorNotice message="We couldn’t load your clients. Please try again." retry={revalidate} />}
    <div className="ui-card grid grid-cols-3 divide-x divide-slate-100 py-5"><div className="px-4 sm:px-6"><p className="text-[11px] text-slate-500">Total clients</p><p className="metric-value mt-2 text-2xl font-semibold">{isLoading ? "—" : clients.length}</p></div><div className="px-4 sm:px-6"><p className="text-[11px] text-slate-500">Active clients</p><p className="metric-value mt-2 text-2xl font-semibold">{isLoading ? "—" : active}<span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" /></p></div><div className="px-4 sm:px-6"><p className="text-[11px] text-slate-500">Total locations</p><p className="metric-value mt-2 text-2xl font-semibold">{isLoading ? "—" : branches}</p></div></div>
    <section className="ui-card overflow-hidden">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:px-6"><div><h2 className="ui-section-title">Client directory</h2><p className="mt-1 text-xs text-slate-500">Select a client to open their restaurant workspace.</p></div><div className="flex items-center gap-2"><div className="relative min-w-0 flex-1"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input aria-label="Search clients" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search clients..." className="ui-input ui-input-search sm:w-56" /></div><button className="ui-button px-3" onClick={revalidate} disabled={isRevalidating} aria-label="Refresh clients"><RefreshCw size={15} className={clsx(isRevalidating && "animate-spin")} /></button></div></div>
      <div className="flex items-center gap-1 border-b border-slate-100 px-5 py-3 sm:px-6">{[{ key: "all", label: "All clients" }, { key: "active", label: "Active" }, { key: "inactive", label: "Inactive" }].map(item => <button key={item.key} onClick={() => setFilter(item.key)} aria-pressed={filter === item.key} className={clsx("rounded-lg px-3 py-2 text-xs font-medium", filter === item.key ? "bg-slate-100 text-slate-800" : "text-slate-500 hover:bg-slate-50")}>{item.label}</button>)}<span className="ml-auto text-[11px] text-slate-500">{filtered.length} results</span></div>
      {isLoading ? <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">{[0,1,2].map(index => <div key={index} className="h-52 animate-pulse rounded-xl bg-slate-50" />)}</div> : error && !clients.length ? <EmptyState title="Client directory unavailable" description="Use Try again above to reload your clients." icon={Building2} /> : !clients.length ? <EmptyState title="Welcome your first client" description="Create a restaurant profile, set up its first location, and give the owner access in a few simple steps." icon={Building2} action={<Link href="/dashboard/clients/new" className="ui-button ui-button-primary"><Plus size={15} />Create client profile</Link>} /> : !filtered.length ? <EmptyState title="No matching clients" description="Try a different name or city, or clear your filters." icon={Search} action={<button className="ui-button" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</button>} /> : <div className="grid gap-4 p-5 sm:p-6 md:grid-cols-2 xl:grid-cols-3">{filtered.map(client => <article key={client.id} className="flex min-w-0 flex-col rounded-xl border border-slate-200 transition hover:border-slate-300 hover:shadow-sm">
        <div className="flex-1 p-5"><div className="mb-5 flex items-center justify-between"><span className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-base font-semibold text-slate-600" style={{ borderBottomColor: client.brand_color, borderBottomWidth: 3 }}>{client.name.slice(0, 2).toUpperCase()}</span><span className={clsx("status-pill", client.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}><span className={clsx("h-1.5 w-1.5 rounded-full", client.is_active ? "bg-emerald-500" : "bg-slate-400")} />{client.is_active ? "Active" : "Inactive"}</span></div><h3 className="truncate text-sm font-semibold text-slate-800">{client.name}</h3><p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500"><MapPin size={11} />{client.city || "City not set"}</p><div className="mt-5 flex flex-wrap items-center gap-3 text-[11px] text-slate-500"><span className="flex items-center gap-1.5"><GitBranch size={13} />{client.branches?.length || 0} locations</span><span className="text-slate-300">/</span><span>/{client.slug}</span></div></div>
        <div className="flex min-h-14 items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">{client.id === session.restaurantId ? <span className="flex items-center gap-1 text-[10px] font-medium text-brand"><Check size={12} />Current workspace</span> : <span className="text-[10px] text-slate-500">Client workspace</span>}<button disabled={!!switching} onClick={() => void openClient(client.id)} className="flex shrink-0 items-center gap-1 text-xs font-medium text-slate-700 hover:text-brand disabled:opacity-50">{switching === client.id ? <Loader2 size={14} className="animate-spin" /> : <>Open<ChevronRight size={14} /></>}</button></div>
      </article>)}</div>}
    </section>
    <div className="flex items-center gap-2 px-1 text-[11px] text-slate-500"><Building2 size={14} /><p>Business profiles, team access and settings are managed inside each client’s workspace.</p><ArrowRight size={13} className="hidden shrink-0 sm:block" /></div>
  </div>;
}
