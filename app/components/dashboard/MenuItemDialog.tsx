"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { clsx } from "clsx";
import { ErrorNotice } from "./WorkspaceUI";

export type CatalogItem = { id?: string; name: string; category: string; description?: string | null; price: number; is_available: boolean; available_days?: string[] | null; available_start_time?: string | null; available_end_time?: string | null };
const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function MenuItemDialog({ item, categories, onClose, onSaved }: { item: CatalogItem; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(item);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = (patch: Partial<CatalogItem>) => setDraft(current => ({ ...current, ...patch }));
  useEffect(() => { dialog.current?.showModal(); dialog.current?.querySelector<HTMLInputElement>("input")?.focus(); }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const payload = { ...draft, name: draft.name.trim(), category: draft.category.trim() || "General", available_days: draft.available_days || [], available_start_time: draft.available_start_time || null, available_end_time: draft.available_end_time || null };
      const response = await fetch(item.id ? `/api/menu/${item.id}` : "/api/menu", { method: item.id ? "PATCH" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item.id ? payload : { items: [payload], replaceAll: false }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save this item. Please try again.");
      onSaved(); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save item."); } finally { setSaving(false); }
  }
  async function remove() {
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/menu/${item.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete this item.");
      onSaved(); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not delete item."); } finally { setSaving(false); }
  }

  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); if (!saving) onClose(); }} aria-labelledby="item-dialog-title" className="m-auto max-h-[90dvh] w-[min(560px,calc(100%-32px))] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-950/30">
    <form onSubmit={save}>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-5"><div><h2 id="item-dialog-title" className="text-lg font-semibold tracking-tight">{item.id ? "Edit menu item" : "Add a menu item"}</h2><p className="mt-1 text-xs text-slate-500">Keep the details clear and appetizing.</p></div><button type="button" disabled={saving} onClick={onClose} aria-label="Close item editor" className="rounded-lg p-2 text-slate-500 hover:bg-slate-50"><X size={18} /></button></div>
      <fieldset disabled={saving} className="space-y-5 px-6 py-5">
        {error && <ErrorNotice message={error} />}
        <label className="block"><span className="ui-label">Item name *</span><input required autoFocus maxLength={200} value={draft.name} onChange={event => update({ name: event.target.value })} className="ui-input" placeholder="e.g. Chicken Biryani" /></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="ui-label">Category</span><input list="item-categories" value={draft.category} onChange={event => update({ category: event.target.value })} className="ui-input" placeholder="e.g. Rice" /><datalist id="item-categories">{categories.map(category => <option key={category}>{category}</option>)}</datalist></label><label className="block"><span className="ui-label">Price (Rs.) *</span><input required min={0} step="0.01" type="number" value={draft.price} onChange={event => update({ price: Number(event.target.value) })} className="ui-input" /></label></div>
        <label className="block"><span className="ui-label">Description</span><textarea rows={3} value={draft.description || ""} onChange={event => update({ description: event.target.value || null })} className="ui-input resize-y" placeholder="Ingredients, serving size, or what’s included in a deal" /></label>
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4"><span><span className="block text-xs font-medium text-slate-700">Available to order</span><span className="mt-1 block text-[11px] text-slate-500">Turn off when the item is sold out.</span></span><input type="checkbox" checked={draft.is_available} onChange={event => update({ is_available: event.target.checked })} className="h-4 w-4" /></label>
        <details className="rounded-xl border border-slate-200" open={!!(item.available_days?.length || item.available_start_time || item.available_end_time)}><summary className="px-4 py-3.5 text-xs font-medium text-slate-600">Availability schedule <span className="ml-1 font-normal text-slate-500">(optional)</span></summary><div className="space-y-4 border-t border-slate-100 p-4"><div><p className="ui-label">Available days</p><div className="flex flex-wrap gap-1.5">{days.map(day => { const selected=draft.available_days?.includes(day); return <button key={day} type="button" aria-pressed={!!selected} onClick={() => update({ available_days: selected ? draft.available_days?.filter(value => value !== day) : [...(draft.available_days || []),day] })} className={clsx("rounded-lg border px-2.5 py-2 text-[11px] capitalize", selected ? "border-orange-200 bg-orange-50 text-brand" : "border-slate-200 text-slate-500")}>{day}</button>; })}</div><p className="mt-2 text-[11px] text-slate-500">Leave all days unselected to offer this item every day.</p></div><div className="grid grid-cols-2 gap-4"><label><span className="ui-label">Start time</span><input type="time" value={draft.available_start_time || ""} onChange={event => update({ available_start_time: event.target.value || null })} className="ui-input" /></label><label><span className="ui-label">End time</span><input type="time" value={draft.available_end_time || ""} onChange={event => update({ available_end_time: event.target.value || null })} className="ui-input" /></label></div></div></details>
        {confirmDelete && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4"><p className="text-xs font-medium text-red-800">Delete “{item.name}” from the menu?</p><div className="mt-3 flex gap-4"><button type="button" onClick={() => void remove()} className="text-xs font-semibold text-red-700">Delete item</button><button type="button" onClick={() => setConfirmDelete(false)} className="text-xs text-slate-600">Keep item</button></div></div>}
      </fieldset>
      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-slate-100 bg-white px-6 py-4"><div>{item.id && <button type="button" disabled={saving} onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 rounded-lg p-2 text-xs text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} />Delete</button>}</div><div className="flex gap-2"><button type="button" disabled={saving} onClick={onClose} className="ui-button">Cancel</button><button type="submit" disabled={saving} className="ui-button ui-button-primary">{saving && <Loader2 size={14} className="animate-spin" />}{saving ? "Saving..." : item.id ? "Save item" : "Add item"}</button></div></div>
    </form>
  </dialog>;
}
