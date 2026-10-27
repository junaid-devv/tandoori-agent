"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Pencil,
  UtensilsCrossed,
  Layers,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
  Zap,
} from "lucide-react";
import { clsx } from "clsx";
import { MenuItemDialog, type CatalogItem } from "@/app/components/dashboard/MenuItemDialog";
import { EmptyState, ErrorNotice } from "@/app/components/dashboard/WorkspaceUI";
import { PageHeader } from "@/app/components/dashboard/PageHeader";
import { useDataCache, invalidateCache } from "@/lib/useDataCache";
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";

const WEEKDAYS = [
  { key: "mon", label: "M" },
  { key: "tue", label: "T" },
  { key: "wed", label: "W" },
  { key: "thu", label: "T" },
  { key: "fri", label: "F" },
  { key: "sat", label: "S" },
  { key: "sun", label: "S" },
] as const;

interface MenuItem {
  id?: string;
  name: string;
  price: number;
  category: string;
  description?: string | null;
  is_available: boolean;
  available_days?: string[] | null;
  available_start_time?: string | null;
  available_end_time?: string | null;
  _saving?: boolean;
  _deleting?: boolean;
}

type ExtractedMenuItem = { name: string; price: number; category?: string; description?: string | null };
type ImportWarning = { code: "duplicate" | "invalid_name" | "invalid_price"; message: string };

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();
const normalizeCategory = (value?: string | null) =>
  normalizeWhitespace(value ?? "")
    .split(" ")
    .filter(Boolean)
    .map((part) => (part.toLowerCase() === "bbq" ? "BBQ" : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join(" ");
const normalizeDays = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((day) => String(day).slice(0, 3).toLowerCase())
        .filter((day) => WEEKDAYS.some((entry) => entry.key === day))
    : [];

function normalizeItems(items: MenuItem[]) {
  const warnings: ImportWarning[] = [];
  const seen = new Set<string>();
  const normalized: MenuItem[] = [];

  items.forEach((item) => {
    const name = normalizeWhitespace(item.name);
    const price = item.price == null || String(item.price).trim() === "" ? NaN : Number(item.price);
    const key = name.toLowerCase();
    const description = item.description ? normalizeWhitespace(item.description) : null;

    if (!name) {
      warnings.push({ code: "invalid_name", message: "One extracted item was skipped because its name was empty." });
      return;
    }

    if (!Number.isFinite(price) || price < 0) {
      warnings.push({ code: "invalid_price", message: `${name} was skipped because its price was invalid.` });
      return;
    }

    if (seen.has(key)) {
      warnings.push({ code: "duplicate", message: `${name} appeared more than once in the import preview.` });
      return;
    }

    seen.add(key);
    normalized.push({
      id: item.id,
      name,
      price,
      category: normalizeCategory(item.category) || "General",
      description,
      is_available: item.is_available ?? true,
      available_days: normalizeDays(item.available_days),
      available_start_time: item.available_start_time || null,
      available_end_time: item.available_end_time || null,
    });
  });

  return { items: normalized, warnings };
}

async function patchItem(id: string, patch: Partial<MenuItem>) {
  const response = await fetch(`/api/menu/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(await response.text());
}

export default function MenuPage() {
  const { profile } = useDashboardContext();
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [importPreview, setImportPreview] = useState<MenuItem[]>([]);
  const [importWarnings, setImportWarnings] = useState<ImportWarning[]>([]);
  const [importMode, setImportMode] = useState<"replace" | "merge">("replace");
  const [processing, setProcessing] = useState(false);
  const [jsonUploading, setJsonUploading] = useState(false);
  const [savingImport, setSavingImport] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" | null }>({ text: "", type: null });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string, type: "success" | "error") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, type });
    toastTimer.current = setTimeout(() => setToast({ text: "", type: null }), 3500);
  }, []);

  // Single-branch: always load menu for the auto-resolved branch (no branch_id param needed)
  const { data: cachedMenu, isLoading: loading, error: menuError, revalidate: revalidateMenu } = useDataCache<MenuItem[]>("/api/menu");

  // Reset optimistic edits when a new server snapshot arrives, before rendering
  // stale rows. Keep edits local while that snapshot is unchanged.
  const [menuSnapshot, setMenuSnapshot] = useState<MenuItem[] | null>(null);
  if (cachedMenu !== menuSnapshot) {
    setMenuSnapshot(cachedMenu);
    setItems(cachedMenu ?? []);
  }

  // Refresh helper used after mutations
  const loadMenu = useCallback(() => {
    invalidateCache("/api/menu");
    revalidateMenu();
  }, [revalidateMenu]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach((item) => {
      const cat = item.category || "General";
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [items]);

  const categories = useMemo(
    () => Object.keys(categoryCounts).sort(),
    [categoryCounts],
  );

  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        const matchesSearch =
          item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (item.category || "").toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
        return matchesSearch && matchesCategory;
      }),
    [items, searchTerm, selectedCategory],
  );

  const mutateItem = (index: number, patch: Partial<MenuItem>) => {
    setItems((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };

  const handleToggle = async (item: MenuItem, index: number) => {
    if (item._saving || !item.id) return;
    const nextValue = !item.is_available;
    mutateItem(index, { is_available: nextValue, _saving: true });

    try {
      await patchItem(item.id, { is_available: nextValue });
    } catch {
      mutateItem(index, { is_available: !nextValue });
      showToast("Could not update availability.", "error");
    } finally {
      mutateItem(index, { _saving: false });
    }
  };

  const handleClearAll = async () => {
    setClearingAll(true);
    try {
      const response = await fetch("/api/menu", {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(await response.text());

      setItems([]);
      setShowClearModal(false);
      showToast("Entire menu cleared successfully.", "success");
      await loadMenu();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to clear menu.", "error");
    } finally {
      setClearingAll(false);
    }
  };

  // Direct Apply from Import Preview with chosen mode
  const handleApplyImportDirectly = async () => {
    if (importPreview.length === 0) return;

    setSavingImport(true);
    try {
      const response = await fetch("/api/menu", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: importPreview.map((item) => ({
            name: item.name,
            price: item.price,
            category: item.category,
            description: item.description ?? null,
            is_available: item.is_available,
            available_days: normalizeDays(item.available_days),
            available_start_time: item.available_start_time || null,
            available_end_time: item.available_end_time || null,
          })),
          replaceAll: importMode === "replace",
        }),
      });

      const body = await response.json();
      if (!response.ok) {
        const issues = body.issues?.map((issue: { message: string }) => issue.message).join(" ");
        throw new Error(issues || body.error || "Failed to save menu");
      }

      showToast(
        importMode === "replace"
          ? `Replaced entire menu with ${importPreview.length} new items!`
          : `Added ${importPreview.length} items to your menu!`,
        "success",
      );
      setImportPreview([]);
      setImportWarnings([]);
      await loadMenu();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to apply menu.", "error");
    } finally {
      setSavingImport(false);
    }
  };

  const handleSavedCardsImport = async () => {
    setProcessing(true);
    try {
      const response = await fetch("/api/menu/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ savedCards: true }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not read the saved menu pictures.");
      const normalized = normalizeItems((payload.items ?? []).map((item: ExtractedMenuItem) => ({ ...item, category: item.category || "General", is_available: true })));
      if (!normalized.items.length) throw new Error("No verified prices found. Please enter the menu items manually.");
      setImportPreview(normalized.items);
      setImportWarnings(normalized.warnings);
      setImportMode("merge");
      setShowImport(true);
      showToast(`Read ${normalized.items.length} items. Review names, sizes and prices before saving.`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Import failed.", "error");
    } finally { setProcessing(false); }
  };

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setProcessing(true);

    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const response = await fetch("/api/menu/process", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageUrl: reader.result as string }),
          });

          if (!response.ok) throw new Error("Could not extract items from image.");
          const payload = (await response.json()) as { items?: ExtractedMenuItem[] };
          const normalized = normalizeItems(
            (payload.items ?? []).map((item) => ({
              name: item.name,
              price: item.price,
              category: item.category || "General",
              description: item.description ?? null,
              is_available: true,
              available_days: [],
              available_start_time: null,
              available_end_time: null,
            })),
          );

          if (normalized.items.length === 0) {
            throw new Error("No menu items could be recognized in the image. Please try a clearer photo.");
          }

          setImportPreview(normalized.items);
          setImportWarnings(normalized.warnings);
          setImportMode("replace"); // Default to replace for fresh uploads
          showToast(`Digitized ${normalized.items.length} items from image. Choose mode below.`, "success");
        } catch (error) {
          showToast(error instanceof Error ? error.message : "Import failed.", "error");
        } finally {
          setProcessing(false);
          event.target.value = "";
        }
      };

      reader.readAsDataURL(file);
    } catch {
      setProcessing(false);
      showToast("Error reading photo.", "error");
    }
  };

  const handleJsonUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setJsonUploading(true);
    try {
      const rawText = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText) as unknown;
      } catch {
        throw new Error("That file is not valid JSON.");
      }

      const rawItems: unknown =
        Array.isArray(parsed)
          ? parsed
          : typeof parsed === "object" && parsed !== null && "items" in parsed && Array.isArray(parsed.items)
            ? parsed.items
            : null;

      if (!Array.isArray(rawItems)) {
        throw new Error("JSON must be an array of items or have an 'items' array property.");
      }

      const normalized = normalizeItems(
        rawItems.map((entry) => {
          const item = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
          return {
            name: typeof item.name === "string" ? item.name : "",
            price: item.price == null || String(item.price).trim() === "" ? NaN : Number(item.price),
            category: typeof item.category === "string" ? item.category : "General",
            description: typeof item.description === "string" ? item.description : null,
            is_available: typeof item.is_available === "boolean" ? item.is_available : true,
            available_days: normalizeDays(item.available_days),
            available_start_time: typeof item.available_start_time === "string" ? item.available_start_time : null,
            available_end_time: typeof item.available_end_time === "string" ? item.available_end_time : null,
          };
        }),
      );

      setImportPreview(normalized.items);
      setImportWarnings(normalized.warnings);
      setImportMode("replace");
      showToast(`Loaded ${normalized.items.length} items from JSON. Choose mode below.`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "JSON upload failed.", "error");
    } finally {
      setJsonUploading(false);
      event.target.value = "";
    }
  };

  return (
    <div className="space-y-5 pb-2">
      <>
        <PageHeader title="Menu catalog" description="A well-organized menu. Easy to browse, simple to keep up to date." actions={<><button disabled={loading || !!menuError} className="ui-button" onClick={() => setShowImport(!showImport)} aria-expanded={showImport}><UploadCloud size={15} />Import menu</button><button disabled={loading || !!menuError} className="ui-button ui-button-primary" onClick={() => setEditingItem({ name: "", price: 0, category: "General", is_available: true })}><Plus size={15} />Add item</button></>} />
        {menuError && <ErrorNotice message="We couldn’t load your menu. Please try again." retry={revalidateMenu} />}
        {!loading && !menuError && items.length === 0 && <section role="alert" className="ui-card border-amber-200 bg-amber-50 p-5"><h2 className="ui-section-title">Ordering needs a priced menu</h2><p className="mt-2 text-sm text-slate-600">Menu pictures are sent to customers, but their items must also be saved here before the assistant can take orders.</p>{profile.menu_card_images.length > 0 && <button className="ui-button mt-4" disabled={processing} onClick={handleSavedCardsImport}><Sparkles size={15} />{processing ? "Reading saved pictures..." : "Import saved menu pictures"}</button>}</section>}
        {showImport && <section className="ui-card p-5 sm:p-6"><div className="mb-5 flex items-start justify-between gap-4"><div><h2 className="ui-section-title">Import your menu</h2><p className="mt-1.5 text-xs text-slate-500">Upload a menu photo or a JSON file. Review every item before adding it.</p></div><button onClick={() => setShowImport(false)} aria-label="Close import options" className="rounded-lg p-1 text-slate-500 hover:bg-slate-50"><X size={16} /></button></div><div className="flex flex-wrap gap-3"><label className="ui-button cursor-pointer"><Sparkles size={15} className="text-brand" />{processing ? "Reading photo..." : "Upload menu photo"}<input type="file" accept="image/*" onChange={handlePhotoUpload} className="sr-only" disabled={processing || jsonUploading} /></label><label className="ui-button cursor-pointer"><UploadCloud size={15} />{jsonUploading ? "Reading file..." : "Import JSON"}<input type="file" accept="application/json,.json" onChange={handleJsonUpload} className="sr-only" disabled={jsonUploading || processing} /></label></div></section>}

          {/* Import Preview */}
          {importPreview.length > 0 && (
            <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-orange-200 pb-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
                    {importPreview.length}
                  </span>
                  <h3 className="text-base font-bold text-slate-900">Extracted Menu Preview</h3>
                </div>
                <button
                  onClick={() => {
                    setImportPreview([]);
                    setImportWarnings([]);
                  }}
                  className="rounded-lg p-1 text-slate-500 hover:bg-orange-100 hover:text-slate-700"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Mode Selector */}
              <div className="mt-4">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                  How should this new menu be applied?
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {/* Option 1: Replace Entire Menu */}
                  <div
                    onClick={() => setImportMode("replace")}
                    className={clsx(
                      "cursor-pointer rounded-xl border p-3.5 transition",
                      importMode === "replace"
                        ? "border-brand bg-white shadow-sm ring-2 ring-brand/20"
                        : "border-orange-200/80 bg-orange-50/50 hover:bg-white",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="importMode"
                        checked={importMode === "replace"}
                        onChange={() => setImportMode("replace")}
                        className="mt-0.5 text-brand focus:ring-brand"
                      />
                      <div>
                        <div className="flex items-center gap-1.5 font-bold text-sm text-slate-900">
                          <Zap size={14} className="text-brand" />
                          <span>Replace Entire Menu (Clean Slate)</span>
                          <span className="rounded bg-emerald-100 px-1.5 py-0.2 text-[10px] font-bold text-emerald-800">
                            Recommended
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600">
                          Deletes all previous items ({items.length} old items) and makes this new menu the ONLY active menu in the database.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Option 2: Merge / Append */}
                  <div
                    onClick={() => setImportMode("merge")}
                    className={clsx(
                      "cursor-pointer rounded-xl border p-3.5 transition",
                      importMode === "merge"
                        ? "border-brand bg-white shadow-sm ring-2 ring-brand/20"
                        : "border-orange-200/80 bg-orange-50/50 hover:bg-white",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="importMode"
                        checked={importMode === "merge"}
                        onChange={() => setImportMode("merge")}
                        className="mt-0.5 text-brand focus:ring-brand"
                      />
                      <div>
                        <div className="flex items-center gap-1.5 font-bold text-sm text-slate-900">
                          <Layers size={14} className="text-slate-600" />
                          <span>Merge & Add to Existing</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600">
                          Keeps all current {items.length} items and adds these {importPreview.length} items alongside them.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Warnings if any */}
              {importWarnings.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {importWarnings.map((warning, index) => (
                    <div
                      key={`${warning.code}-${index}`}
                      className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800 border border-amber-200"
                    >
                      <AlertCircle size={13} className="shrink-0" />
                      <span>{warning.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Sample extracted preview list */}
              <div className="mt-4 max-h-48 overflow-y-auto rounded-xl border border-orange-200 bg-white p-2.5 text-xs">
                <div className="font-semibold text-slate-500 mb-1.5 px-1 flex justify-between">
                  <span>Sample Extracted Items ({importPreview.length} Total):</span>
                  <span>Price (Rs.)</span>
                </div>
                <div className="space-y-1 divide-y divide-slate-100">
                  {importPreview.slice(0, 10).map((it, idx) => (
                    <div key={idx} className="flex justify-between py-1 px-1">
                      <span className="font-medium text-slate-800">
                        {it.name} <span className="text-slate-500">({it.category})</span>
                      </span>
                      <span className="font-bold text-slate-900">Rs. {it.price}</span>
                    </div>
                  ))}
                  {importPreview.length > 10 && (
                    <p className="pt-2 text-center text-slate-500 font-medium">
                      + and {importPreview.length - 10} more items...
                    </p>
                  )}
                </div>
              </div>

              {/* Confirm & Save Button */}
              <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
                <button
                  onClick={() => {
                    setImportPreview([]);
                    setImportWarnings([]);
                  }}
                  className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Discard
                </button>

                <button
                  onClick={() => void handleApplyImportDirectly()}
                  disabled={savingImport}
                  className="flex h-9 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-xs font-bold text-white shadow transition hover:bg-brand-hover disabled:opacity-50"
                >
                  {savingImport ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Saving menu...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={14} />
                      <span>
                        {importMode === "replace"
                          ? `Confirm: Replace Entire Menu with ${importPreview.length} Items`
                          : `Confirm: Merge ${importPreview.length} Items`}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Search & Filter Toolbar */}
          <div className="ui-card flex flex-col flex-wrap items-center gap-3 p-3 sm:flex-row">
            <div className="relative min-w-0 w-full sm:max-w-md sm:flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                aria-label="Search menu items" placeholder="Search items or categories..."
                className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs outline-none focus:border-orange-200 focus:bg-white focus:ring-1 focus:ring-brand/10"
              />
            </div>

            <select
              value={selectedCategory}
              onChange={(event) => setSelectedCategory(event.target.value)}
              aria-label="Filter by category" className="h-10 w-full sm:w-auto sm:max-w-[220px] rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-orange-200"
            >
              <option value="all">All categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category} ({categoryCounts[category]})
                </option>
              ))}
            </select>
          </div>

        <section className="ui-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6"><h2 className="ui-section-title">{selectedCategory === "all" ? "All menu items" : selectedCategory}<span className="ml-2 text-xs font-normal text-slate-500">{filteredItems.length}</span></h2><span className="text-[11px] text-slate-500">{items.filter(item => item.is_available).length} available</span></div>
          {loading ? <div className="space-y-4 p-6">{[0,1,2,3].map(index => <div key={index} className="h-14 animate-pulse rounded-lg bg-slate-50" />)}</div> : menuError && !items.length ? <EmptyState title="Menu temporarily unavailable" description="Use Try again above to reload your saved menu." icon={UtensilsCrossed} /> : !filteredItems.length ? <EmptyState title={items.length ? "No matching menu items" : "Build a menu customers will love"} description={items.length ? "Try another search or choose a different category." : "Add your first item or import a menu photo to get started."} icon={UtensilsCrossed} action={!items.length ? <button className="ui-button ui-button-primary" onClick={() => setEditingItem({ name: "", price: 0, category: "General", is_available: true })}><Plus size={15} />Add your first item</button> : <button className="ui-button" onClick={() => { setSearchTerm(""); setSelectedCategory("all"); }}>Clear filters</button>} /> : <div className="divide-y divide-slate-100">{filteredItems.map(item => { const index=items.findIndex(entry => entry.id === item.id); return <article key={item.id} className="catalog-row group flex flex-wrap items-center gap-4 px-5 py-3.5 hover:bg-slate-50/40 sm:flex-nowrap sm:px-6"><div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-slate-50 text-slate-500 sm:flex"><UtensilsCrossed size={18} strokeWidth={1.5} /></div><div className="min-w-0 flex-1"><h3 className="text-[13px] font-medium text-slate-800">{item.name}</h3><p className="mt-1.5 text-[11px] text-slate-500"><span className="font-medium text-slate-500">{item.category || "General"}</span>{item.description && <span className="ml-2 hidden sm:inline">· {item.description}</span>}</p>{(item.available_days?.length || item.available_start_time || item.available_end_time) && <p className="mt-1 text-[10px] text-slate-500">{item.available_days?.length ? item.available_days.join(", ") : "Every day"}{item.available_start_time ? " · " + item.available_start_time + "–" + (item.available_end_time || "close") : ""}</p>}</div><div className="ml-auto flex items-center gap-4 sm:gap-6"><span className="whitespace-nowrap text-[13px] font-semibold text-slate-700">Rs. {Number(item.price).toLocaleString()}</span><button aria-label={"Mark " + item.name + " as " + (item.is_available ? "unavailable" : "available")} role="switch" aria-checked={item.is_available} disabled={item._saving} onClick={() => void handleToggle(item,index)} className={clsx("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition", item.is_available ? "bg-brand" : "bg-slate-200")}><span className={clsx("h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-transform", item.is_available ? "translate-x-[19px]" : "translate-x-[3px]")} /></button><button onClick={() => setEditingItem(item)} aria-label={"Edit " + item.name} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-white hover:text-slate-700"><Pencil size={14} /></button></div></article>; })}</div>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4 text-[11px] text-slate-500"><span>{items.length} items across {categories.length} categories</span><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Available to order</span></div>
        </section>
        {items.length > 0 && <details className="px-1 text-xs text-slate-500"><summary className="w-fit">Advanced menu actions</summary><button onClick={() => setShowClearModal(true)} className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs text-red-600 hover:bg-red-50"><Trash2 size={13} />Clear entire menu</button></details>}
        {editingItem && <MenuItemDialog item={editingItem} categories={categories} onClose={() => setEditingItem(null)} onSaved={() => { loadMenu(); showToast("Menu updated.", "success"); }} />}

      {/* Clear All Confirmation Modal */}
      {showClearModal && (
        <dialog ref={node => { if (node && !node.open) node.showModal(); }} aria-labelledby="clear-menu-title" onCancel={event => { event.preventDefault(); if (!clearingAll) setShowClearModal(false); }} className="m-auto w-[min(448px,calc(100%-32px))] rounded-2xl border-0 bg-white p-0 shadow-2xl backdrop:bg-slate-950/30">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 mb-4">
              <Trash2 size={24} />
            </div>
            <h3 id="clear-menu-title" className="text-lg font-semibold text-slate-900">Clear the entire menu?</h3>
            <p className="mt-2 text-sm text-slate-600">
              Are you sure you want to permanently delete all <strong className="text-slate-900">{items.length} menu items</strong>, categories, and AI search embeddings? This will clear the entire menu catalog.
            </p>
            <p className="mt-1 text-xs text-red-600 font-semibold">This action cannot be undone.</p>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowClearModal(false)}
                disabled={clearingAll}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleClearAll()}
                disabled={clearingAll}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {clearingAll ? <Loader2 size={14} className="animate-spin" /> : null}
                <span>{clearingAll ? "Deleting..." : "Yes, Delete Everything"}</span>
              </button>
            </div>
          </div>
        </dialog>
      )}

      {/* Floating Toast Notification */}
      {toast.text && (
        <div role="status" className="fixed bottom-5 left-4 right-4 sm:left-auto sm:right-8 z-[100] flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5 shadow-xl">
          {toast.type === "success" ? (
            <CheckCircle2 size={18} className="text-emerald-500" />
          ) : (
            <AlertCircle size={18} className="text-red-500" />
          )}
          <p className="text-sm font-semibold text-slate-800">{toast.text}</p>
        </div>
      )}
      </>
    </div>
  );
}
