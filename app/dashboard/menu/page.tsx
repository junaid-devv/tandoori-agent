"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Filter,
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
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";
import { PageHeader } from "@/app/components/dashboard/PageHeader";
import { useDataCache, invalidateCache } from "@/lib/useDataCache";

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

type ExtractedMenuItem = { name: string; price: number; category?: string };
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
    const price = Number(item.price);
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

async function deleteItem(id: string) {
  const response = await fetch(`/api/menu/${id}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await response.text());
}

export default function MenuPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [importPreview, setImportPreview] = useState<MenuItem[]>([]);
  const [importWarnings, setImportWarnings] = useState<ImportWarning[]>([]);
  const [importMode, setImportMode] = useState<"replace" | "merge">("replace");
  const [processing, setProcessing] = useState(false);
  const [jsonUploading, setJsonUploading] = useState(false);
  const [savingImport, setSavingImport] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
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
  const { data: cachedMenu, isLoading: loading, revalidate: revalidateMenu } = useDataCache<MenuItem[]>("/api/menu");

  // Sync cached menu into local editable state
  useEffect(() => {
    if (cachedMenu) {
      setItems(cachedMenu);
    }
  }, [cachedMenu]);

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

  const handleBlurSave = async (item: MenuItem, index: number) => {
    if (!item.id || !item.name.trim()) return;
    mutateItem(index, { _saving: true });
    try {
      await patchItem(item.id, {
        name: item.name,
        price: item.price,
        category: item.category,
        description: item.description ?? null,
        is_available: item.is_available,
        available_days: normalizeDays(item.available_days),
        available_start_time: item.available_start_time || null,
        available_end_time: item.available_end_time || null,
      });
    } catch {
      showToast("Failed to save row.", "error");
    } finally {
      mutateItem(index, { _saving: false });
    }
  };

  const handleToggle = async (item: MenuItem, index: number) => {
    const nextValue = !item.is_available;
    mutateItem(index, { is_available: nextValue });
    if (!item.id) return;

    try {
      await patchItem(item.id, { is_available: nextValue });
    } catch {
      mutateItem(index, { is_available: !nextValue });
      showToast("Could not update availability.", "error");
    }
  };

  const handleSchedulePatch = async (item: MenuItem, index: number, patch: Partial<MenuItem>) => {
    mutateItem(index, patch);
    if (!item.id) return;

    try {
      await patchItem(item.id, patch);
    } catch {
      showToast("Could not update schedule.", "error");
      await loadMenu();
    }
  };

  const handleDelete = async (item: MenuItem, index: number) => {
    if (!item.id) {
      setItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
      return;
    }

    mutateItem(index, { _deleting: true });
    try {
      await deleteItem(item.id);
      setItems((prev) => prev.filter((entry) => entry.id !== item.id));
      showToast("Item deleted.", "success");
    } catch {
      mutateItem(index, { _deleting: false });
      showToast("Delete failed.", "error");
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

  const handleSaveAll = async () => {
    setBulkSaving(true);
    try {
      const response = await fetch("/api/menu", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.filter((item) => item.name.trim()),
          replaceAll: false,
        }),
      });

      const body = await response.json();
      if (!response.ok) {
        const issues = body.issues?.map((issue: { message: string }) => issue.message).join(" ");
        throw new Error(issues || body.error || "Failed to save menu");
      }

      showToast("All changes saved & AI search indexed.", "success");
      await loadMenu();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save menu.", "error");
    } finally {
      setBulkSaving(false);
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
            price: typeof item.price === "number" ? item.price : Number(item.price) || 0,
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
    <div className="space-y-5 pb-10">
      <>
        {/* Header */}
        <PageHeader
          title="Menu Catalog & AI Digitizer"
          description="Manage menu items, upload photos for instant AI digitization, and configure schedules. Changes automatically sync to the WhatsApp AI Agent."
          meta={
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-bold text-brand ring-1 ring-inset ring-orange-200">
                  {items.length} Live Items
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {categories.length} Categories
                </span>
              </div>
            }
            actions={
              <div className="flex items-center gap-2">
                {items.length > 0 && (
                  <button
                    onClick={() => setShowClearModal(true)}
                    className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-600 shadow-sm transition hover:bg-red-50"
                  >
                    <Trash2 size={14} />
                    <span className="hidden sm:inline">Clear Entire Menu</span>
                  </button>
                )}

                <button
                  onClick={() => void handleSaveAll()}
                  disabled={bulkSaving || items.length === 0}
                  className="flex h-9 items-center justify-center gap-2 rounded-lg bg-brand px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-hover disabled:opacity-50"
                >
                  {bulkSaving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  <span>Save All Changes</span>
                </button>
              </div>
            }
          />

          {/* AI Upload & Digitization Action Bar */}
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-100 text-brand">
                    <Sparkles size={16} />
                  </div>
                  <h2 className="text-sm font-bold text-slate-900">Upload & AI Menu Digitizer</h2>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Take a photo of a physical paper menu or upload a JSON catalog. AI extracts all items, categories, and prices automatically.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2 xs:grid-cols-2 sm:flex sm:flex-wrap sm:items-center">
                {/* Photo Upload */}
                <label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-orange-200 bg-white px-3.5 text-xs font-bold text-brand shadow-sm transition hover:bg-orange-50 disabled:opacity-50">
                  {processing ? <Loader2 className="h-4 w-4 animate-spin text-brand" /> : <UploadCloud size={15} />}
                  <span>{processing ? "Analyzing Photo..." : "Upload Menu Photo"}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoUpload}
                    className="hidden"
                    disabled={processing || jsonUploading}
                  />
                </label>

                {/* JSON Upload */}
                <label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50">
                  {jsonUploading ? <Loader2 className="h-4 w-4 animate-spin text-slate-700" /> : <UploadCloud size={15} className="text-slate-500" />}
                  <span>{jsonUploading ? "Reading JSON..." : "Import JSON"}</span>
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={handleJsonUpload}
                    className="hidden"
                    disabled={jsonUploading || processing}
                  />
                </label>

                {/* Add Row Button */}
                <button
                  onClick={() =>
                    setItems((prev) => [
                      {
                        name: "",
                        price: 0,
                        category: "General",
                        is_available: true,
                        available_days: [],
                        available_start_time: null,
                        available_end_time: null,
                      },
                      ...prev,
                    ])
                  }
                  className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800"
                >
                  <Plus size={14} />
                  <span>+ New Item</span>
                </button>
              </div>
            </div>
          </div>

          {/* Import Preview & Mode Selection Modal / Card */}
          {importPreview.length > 0 && (
            <div className="rounded-2xl border-2 border-brand/30 bg-orange-50/70 p-5 shadow-md">
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
                  className="rounded-lg p-1 text-slate-400 hover:bg-orange-100 hover:text-slate-700"
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
                        {it.name} <span className="text-slate-400">({it.category})</span>
                      </span>
                      <span className="font-bold text-slate-900">Rs. {it.price}</span>
                    </div>
                  ))}
                  {importPreview.length > 10 && (
                    <p className="pt-2 text-center text-slate-400 font-medium">
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
                      <span>Saving & Indexing AI Vectors...</span>
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

          {/* Category Chips Bar */}
          {categories.length > 0 && (
            <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto py-1 text-xs">
              <span className="flex shrink-0 items-center gap-1 font-bold text-slate-400 pr-1">
                <Filter size={13} />
                <span className="hidden sm:inline">Filter:</span>
              </span>
              <button
                onClick={() => setSelectedCategory("all")}
                className={clsx(
                  "shrink-0 rounded-full px-3 py-1.5 font-bold transition",
                  selectedCategory === "all"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50",
                )}
              >
                All Items ({items.length})
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={clsx(
                    "shrink-0 rounded-full px-3 py-1.5 font-semibold transition",
                    selectedCategory === cat
                      ? "bg-brand text-white shadow-sm"
                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50",
                  )}
                >
                  {cat} ({categoryCounts[cat]})
                </button>
              ))}
            </div>
          )}

          {/* Search & Filter Toolbar */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="grid gap-2.5 border-b border-slate-200 bg-slate-50/95 p-2.5 backdrop-blur sm:p-3 sm:grid-cols-[1fr_220px]">
              <div className="relative min-w-0">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder={`Search ${filteredItems.length} items by name or category...`}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-orange-200 focus:ring-2 focus:ring-brand/10"
                />
              </div>

              <select
                value={selectedCategory}
                onChange={(event) => setSelectedCategory(event.target.value)}
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-orange-200 focus:ring-2 focus:ring-brand/10"
              >
                <option value="all">All Categories ({items.length})</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category} ({categoryCounts[category]})
                  </option>
                ))}
              </select>
            </div>

            {/* Mobile Cards */}
            <div className="block divide-y divide-slate-100 md:hidden">
              {loading && filteredItems.length === 0 ? (
                Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="h-36 animate-pulse bg-slate-50" />
                ))
              ) : filteredItems.length === 0 ? (
                <div className="px-4 py-16 text-center text-slate-500">
                  <p className="text-sm font-medium">No menu items match your search or filter.</p>
                </div>
              ) : (
                filteredItems.map((item) => {
                  const index = items.findIndex((entry) => (item.id ? entry.id === item.id : entry === item));
                  return (
                    <div
                      key={item.id ?? `mobile-draft-${index}`}
                      className={clsx("space-y-2.5 p-3", item._deleting && "pointer-events-none opacity-40")}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {item._saving && <Loader2 size={12} className="shrink-0 animate-spin text-brand" />}
                            <input
                              value={item.name}
                              onChange={(event) => mutateItem(index, { name: event.target.value })}
                              onBlur={() => void handleBlurSave(item, index)}
                              placeholder="e.g. Chicken Handi"
                              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold outline-none focus:border-orange-200 focus:bg-white focus:ring-2 focus:ring-brand/10"
                            />
                          </div>
                        </div>
                        <button
                          onClick={() => void handleDelete(item, index)}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                        >
                          {item._deleting ? <Loader2 size={16} className="animate-spin text-red-400" /> : <Trash2 size={16} />}
                        </button>
                      </div>

                      <div className="grid grid-cols-[minmax(0,1fr)_104px_44px] items-end gap-2">
                        <label className="block min-w-0">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Category</span>
                          <input
                            value={item.category}
                            onChange={(event) => mutateItem(index, { category: event.target.value })}
                            onBlur={() => void handleBlurSave(item, index)}
                            placeholder="Special Flavor"
                            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-orange-200 focus:bg-white focus:ring-2 focus:ring-brand/10"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Price (Rs.)</span>
                          <div className="mt-1 flex h-9 items-center rounded-lg border border-slate-200 bg-slate-50 px-2 focus-within:border-orange-200 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand/10">
                            <input
                              type="number"
                              value={item.price || ""}
                              onChange={(event) => mutateItem(index, { price: Number(event.target.value) || 0 })}
                              onBlur={() => void handleBlurSave(item, index)}
                              className="w-full bg-transparent text-sm font-semibold outline-none"
                            />
                          </div>
                        </label>
                        <label className="block">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Live</span>
                          <button
                            onClick={() => void handleToggle(item, index)}
                            className={clsx(
                              "mt-1 relative inline-flex h-9 w-11 items-center rounded-lg transition-colors",
                              item.is_available ? "bg-emerald-500" : "bg-slate-200",
                            )}
                          >
                            <span
                              className={clsx(
                                "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
                                item.is_available ? "translate-x-5" : "translate-x-1",
                              )}
                            />
                          </button>
                        </label>
                      </div>

                      <label className="block pt-1">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Description / Deals Details</span>
                        <input
                          value={item.description ?? ""}
                          onChange={(event) => mutateItem(index, { description: event.target.value || null })}
                          onBlur={() => void handleBlurSave(item, index)}
                          placeholder="e.g. 1 Large Pizza, 2 Burgers, 1.5L Drink"
                          className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-600 outline-none focus:border-orange-200 focus:bg-white focus:ring-2 focus:ring-brand/10"
                        />
                      </label>
                    </div>
                  );
                })
              )}
            </div>

            {/* Desktop Table */}
            <div className="hidden overflow-x-auto md:block">
              <div className="min-w-[1100px]">
                <div className="grid grid-cols-[1.8fr_1fr_1.8fr_90px_230px_60px_50px] gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <div>Item Name</div>
                  <div>Category</div>
                  <div>Description / Deals Info</div>
                  <div>Price (Rs.)</div>
                  <div>Schedule / Days</div>
                  <div className="text-center">Live</div>
                  <div className="text-center">Delete</div>
                </div>

                <div className="divide-y divide-slate-100">
                  {loading && filteredItems.length === 0 ? (
                    Array.from({ length: 6 }).map((_, index) => (
                      <div key={index} className="h-14 animate-pulse bg-slate-50" />
                    ))
                  ) : filteredItems.length === 0 ? (
                    <div className="py-20 text-center text-slate-500">
                      <p className="text-sm font-medium">No menu items match your search or filter.</p>
                    </div>
                  ) : (
                    filteredItems.map((item) => {
                      const index = items.findIndex((entry) => (item.id ? entry.id === item.id : entry === item));
                      return (
                        <div
                          key={item.id ?? `draft-${index}`}
                          className={clsx(
                            "grid grid-cols-[1.8fr_1fr_1.8fr_90px_230px_60px_50px] gap-2 px-4 py-2 items-center hover:bg-slate-50/70 transition-colors",
                            item._deleting && "pointer-events-none opacity-40",
                          )}
                        >
                          {/* Name */}
                          <div className="flex items-center gap-2">
                            {item._saving && <Loader2 size={12} className="animate-spin text-brand" />}
                            <input
                              value={item.name}
                              onChange={(event) => mutateItem(index, { name: event.target.value })}
                              onBlur={() => void handleBlurSave(item, index)}
                              placeholder="e.g. Garlic Naan"
                              className="h-8 w-full rounded-lg border border-transparent bg-transparent px-2 text-sm font-medium outline-none transition hover:bg-slate-100/80 focus:border-orange-200 focus:bg-white focus:ring-2 focus:ring-brand/10"
                            />
                          </div>

                          {/* Category */}
                          <input
                            value={item.category}
                            onChange={(event) => mutateItem(index, { category: event.target.value })}
                            onBlur={() => void handleBlurSave(item, index)}
                            placeholder="e.g. Breads"
                            className="h-8 w-full rounded-lg border border-transparent bg-transparent px-2 text-sm outline-none transition hover:bg-slate-100/80 focus:border-orange-200 focus:bg-white focus:ring-2 focus:ring-brand/10"
                          />

                          {/* Description */}
                          <input
                            value={item.description ?? ""}
                            onChange={(event) => mutateItem(index, { description: event.target.value || null })}
                            onBlur={() => void handleBlurSave(item, index)}
                            placeholder="e.g. 1 Pizza, 2 Burgers..."
                            className="h-8 w-full rounded-lg border border-transparent bg-transparent px-2 text-xs text-slate-600 outline-none transition hover:bg-slate-100/80 focus:border-orange-200 focus:bg-white focus:ring-2 focus:ring-brand/10"
                          />

                          {/* Price */}
                          <div className="flex h-8 items-center rounded-lg border border-transparent px-2 transition hover:bg-slate-100/80 focus-within:border-orange-200 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand/10">
                            <input
                              type="number"
                              value={item.price || ""}
                              onChange={(event) => mutateItem(index, { price: Number(event.target.value) || 0 })}
                              onBlur={() => void handleBlurSave(item, index)}
                              className="w-full bg-transparent text-sm font-semibold outline-none"
                            />
                          </div>

                          {/* Schedule / Weekdays */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              {WEEKDAYS.map((day) => {
                                const selectedDays = normalizeDays(item.available_days);
                                const isSelected = selectedDays.includes(day.key);
                                return (
                                  <button
                                    key={day.key}
                                    type="button"
                                    title={day.key}
                                    onClick={() => {
                                      const nextDays = isSelected
                                        ? selectedDays.filter((entry) => entry !== day.key)
                                        : [...selectedDays, day.key];
                                      void handleSchedulePatch(item, index, { available_days: nextDays });
                                    }}
                                    className={clsx(
                                      "h-5 w-5 rounded text-[10px] font-bold transition",
                                      isSelected
                                        ? "bg-brand text-white"
                                        : "bg-slate-100 text-slate-500 hover:bg-slate-200",
                                    )}
                                  >
                                    {day.label}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="grid grid-cols-2 gap-1.5">
                              <input
                                type="time"
                                value={item.available_start_time ?? ""}
                                onChange={(event) => mutateItem(index, { available_start_time: event.target.value || null })}
                                onBlur={(event) => void handleSchedulePatch(item, index, { available_start_time: event.currentTarget.value || null })}
                                className="h-6 rounded border border-slate-200 bg-white px-1.5 text-[10px] outline-none focus:border-orange-200"
                              />
                              <input
                                type="time"
                                value={item.available_end_time ?? ""}
                                onChange={(event) => mutateItem(index, { available_end_time: event.target.value || null })}
                                onBlur={(event) => void handleSchedulePatch(item, index, { available_end_time: event.currentTarget.value || null })}
                                className="h-6 rounded border border-slate-200 bg-white px-1.5 text-[10px] outline-none focus:border-orange-200"
                              />
                            </div>
                          </div>

                          {/* Live Toggle */}
                          <div className="flex justify-center">
                            <button
                              onClick={() => void handleToggle(item, index)}
                              className={clsx(
                                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                                item.is_available ? "bg-emerald-500" : "bg-slate-200",
                              )}
                            >
                              <span
                                className={clsx(
                                  "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform",
                                  item.is_available ? "translate-x-4.5" : "translate-x-0.5",
                                )}
                              />
                            </button>
                          </div>

                          {/* Delete */}
                          <div className="flex justify-center">
                            {item._deleting ? (
                              <Loader2 size={16} className="animate-spin text-red-400" />
                            ) : (
                              <button
                                onClick={() => void handleDelete(item, index)}
                                className="rounded-lg p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>

      {/* Clear All Confirmation Modal */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 mb-4">
              <Trash2 size={24} />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Delete Entire Menu?</h3>
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
        </div>
      )}

      {/* Floating Toast Notification */}
      {toast.text && (
        <div className="fixed bottom-8 right-8 z-[100] flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5 shadow-xl">
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
