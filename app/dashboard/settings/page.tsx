"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import {
  Bot,
  CheckCircle2,
  Clock,
  Phone,
  RefreshCw,
  Save,
  Store,
  Truck,
  Database,
  Volume2,
  VolumeX,
  Bell,
  Building2,
  Check,
  Trash2,
  Printer,
} from "lucide-react";
import { clsx } from "clsx";
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";
import { ErrorNotice } from "@/app/components/dashboard/WorkspaceUI";
import { PageHeader } from "@/app/components/dashboard/PageHeader";
import { toast } from "sonner";
import { printTestReceipt } from "@/lib/thermal-printer";
import { useDataCache, invalidateCache } from "@/lib/useDataCache";

type SettingsTab = "operations" | "delivery" | "ai_brand" | "contacts" | "database" | "notifications";

type SettingsState = {
  is_accepting_orders: boolean;
  opening_time: string;
  closing_time: string;
  delivery_enabled: boolean;
  delivery_fee: number;
  min_delivery_amount: number;
  delivery_areas: string[];
  estimated_prep_minutes: number;
  estimated_delivery_minutes: number;
  city: string;
  phone_delivery: string;
  phone_dine_in: string;
  ai_personality: string;
};

type DatabaseSystemStats = {
  database: {
    status: string;
    ping_latency_ms: number;
    provider: string;
    ssl_enabled: boolean;
    pooling_enabled: boolean;
  };
  table_counts: {
    orders: number;
    active_orders: number;
    conversations: number;
    messages: number;
    contacts: number;
    menu_items: number;
    agent_turns: number;
    webhook_events: number;
    staff_alerts: number;
    unread_alerts: number;
    rate_limits: number;
  };
  cache: {
    active_entries: number;
  };
};

const CITY_OPTIONS = ["Rawalpindi", "Islamabad", "Lahore", "Karachi", "Peshawar"] as const;

const AI_PERSONALITY_PRESETS = [
  {
    title: "Warm & Professional",
    desc: "Polite Pakistani hospitality style. Uses 'Salam', 'Jee zaroor', and ensures polite confirmation.",
    sample: "Salam! Hamari Chicken Creamy Handi bohat pasand ki jati hai. Kya aap ka order shuru karein?",
  },
  {
    title: "Fast & Direct",
    desc: "Concise and to the point. Minimal text, rapid item confirmation.",
    sample: "Chicken Handi (Rs. 2595) available hai. Kya quantity add karein?",
  },
  {
    title: "Friendly & Casual",
    desc: "Relaxed conversational local tone. Warm and helpful.",
    sample: "Aoa bhai! Zaroor, Gulberg me 40 min me deliver ho jayega. Kya kya pack karein?",
  },
  {
    title: "Premium & Polished",
    desc: "Refined, formal language suitable for upscale dining.",
    sample: "Good day! We would be delighted to prepare your dinner reservation for tonight.",
  },
] as const;

function toTimeInputValue(value: string): string {
  const normalized = value.trim();
  const twelveHour = normalized.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (twelveHour) {
    let hours = Number.parseInt(twelveHour[1], 10) % 12;
    const minutes = Number.parseInt(twelveHour[2], 10);
    if (twelveHour[3].toUpperCase() === "PM") hours += 12;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  return /^\d{2}:\d{2}$/.test(normalized) ? normalized : "";
}

function toMeridiemLabel(value: string): string {
  const [rawHours, rawMinutes] = value.split(":").map(Number);
  const period = rawHours >= 12 ? "PM" : "AM";
  const displayHours = rawHours % 12 === 0 ? 12 : rawHours % 12;
  return `${displayHours}:${String(rawMinutes).padStart(2, "0")} ${period}`;
}

export default function SettingsPage() {
  const {
    session,
    profile,
    isSoundEnabled,
    toggleSoundEnabled,
    isAutoPrintEnabled,
    toggleAutoPrintEnabled,
    receiptPaperWidth,
    setReceiptPaperWidth,
  } = useDashboardContext();

  const [activeTab, setActiveTab] = useState<SettingsTab>("operations");
  useEffect(() => {
    const sync = () => {
      const key = window.location.hash.slice(1);
      if (["operations", "delivery", "ai_brand", "contacts", "notifications"].includes(key) || (key === "database" && session.role === "super_admin")) setActiveTab(key as SettingsTab);
    };
    sync(); window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [session.role]);
  const [saving, setSaving] = useState(false);
  const [purgingCache, setPurgingCache] = useState(false);
  const [dbStats, setDbStats] = useState<DatabaseSystemStats | null>(null);
  const [loadingDbStats, setLoadingDbStats] = useState(false);

  const [settings, setSettings] = useState<SettingsState>({
    is_accepting_orders: true,
    opening_time: "10:00 AM",
    closing_time: "11:00 PM",
    delivery_enabled: false,
    delivery_fee: 0,
    min_delivery_amount: 0,
    delivery_areas: [],
    estimated_prep_minutes: 30,
    estimated_delivery_minutes: 45,
    city: "",
    phone_delivery: "",
    phone_dine_in: "",
    ai_personality: "Warm & Professional",
  });

  // Single-branch: always load settings for the auto-resolved branch (no branch_id param needed)
  const { data: cachedSettings, isLoading: loading, error: settingsError, revalidate: revalidateSettings } = useDataCache<Partial<SettingsState>>("/api/settings");

  // Merge cached data into local editable state
  useEffect(() => {
    if (cachedSettings) {
      setSettings((current) => ({ ...current, ...cachedSettings }));
    }
  }, [cachedSettings]);

  // Load database telemetry
  const loadDatabaseStats = useCallback(async () => {
    setLoadingDbStats(true);
    try {
      const res = await fetch("/api/settings/system");
      if (res.ok) {
        const data = await res.json();
        setDbStats(data);
      }
    } catch {
      toast.error("Failed to load database stats");
    } finally {
      setLoadingDbStats(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "database" && session.role === "super_admin") {
      void loadDatabaseStats();
    }
  }, [activeTab, loadDatabaseStats]);

  const cityOptions = useMemo(
    () => [...new Set([profile.city, ...CITY_OPTIONS].map((city) => city.trim()).filter(Boolean))],
    [profile.city]
  );

  const selectedCityOption = cityOptions.includes(settings.city) ? settings.city : "__custom__";

  async function save() {
    setSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        throw new Error("Save failed");
      }
      invalidateCache("/api/settings");
      toast.success("Settings saved successfully.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handlePurgeCache() {
    setPurgingCache(true);
    try {
      const res = await fetch("/api/settings/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_cache" }),
      });
      if (res.ok) {
        toast.success("In-memory cache purged successfully.");
        void loadDatabaseStats();
      }
    } catch {
      toast.error("Failed to purge cache");
    } finally {
      setPurgingCache(false);
    }
  }

  const playTestSound = () => {
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
      gainNode.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
      toast.success("Test chime played");
    } catch {
      toast.error("Audio playback not supported");
    }
  };

  const [testingPrint, setTestingPrint] = useState(false);

  const handleTestPrint = async () => {
    setTestingPrint(true);
    try {
      const ok = await printTestReceipt(
        profile.app_name,
        receiptPaperWidth
      );
      if (ok) {
        toast.success("Test receipt sent to printer!");
      } else {
        toast.error("Could not trigger print job.");
      }
    } catch {
      toast.error("Failed to print test receipt.");
    } finally {
      setTestingPrint(false);
    }
  };

  const tabs: { key: SettingsTab; label: string; icon: React.ReactNode; badge?: string }[] = [
    { key: "operations", label: "Business hours", icon: <Store size={14} /> },
    { key: "delivery", label: "Delivery", icon: <Truck size={14} />, badge: settings.delivery_enabled ? "ON" : "OFF" },
    { key: "ai_brand", label: "Assistant voice", icon: <Bot size={14} /> },
    { key: "contacts", label: "Contact details", icon: <Phone size={14} /> },
    ...(session.role === "super_admin" ? [{ key: "database" as const, label: "System health", icon: <Database size={14} /> }] : []),
    { key: "notifications", label: "Notifications & printing", icon: <Bell size={14} /> },
  ];

  return (
    <div className="space-y-5 pb-2">
      <PageHeader title="Settings" description="Make the workspace work the way your restaurant does." actions={!["database", "notifications"].includes(activeTab) && <button onClick={() => void save()} disabled={saving || loading || !!settingsError} className="ui-button ui-button-primary">{saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}{saving ? "Saving..." : "Save changes"}</button>} />
      {settingsError && <ErrorNotice message="We couldn’t load your saved settings. Please try again." retry={revalidateSettings} />}
      <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="min-w-0 lg:sticky lg:top-0">
          <p className="ui-eyebrow mb-3 hidden px-3 lg:block">Preferences</p>
          <nav aria-label="Settings sections" className="settings-navigation no-scrollbar flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {tabs.map(({key, label, icon}) => <button key={key} onClick={() => { setActiveTab(key); window.history.replaceState(null, "", `#${key}`); }} aria-current={activeTab === key ? "page" : undefined} className={clsx("flex min-h-11 shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-medium transition", activeTab === key ? "border border-slate-200 bg-white text-slate-800 shadow-xs" : "border border-transparent text-slate-500 hover:bg-slate-100")}><span className={activeTab === key ? "text-brand" : "text-slate-400"}>{icon}</span><span>{label}</span></button>)}
          </nav>
          {session.role !== "branch_staff" && <div className="mt-5 hidden border-t border-slate-200 px-3 pt-5 lg:block"><p className="text-[11px] leading-relaxed text-slate-400">Need to change the business profile or team access?</p><Link href="/dashboard/admin" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-brand">Open Administration <span aria-hidden="true">→</span></Link></div>}
        </aside>
        <div className="settings-body min-w-0 space-y-5">
          <div className="px-1"><h2 className="ui-section-title">{tabs.find(item => item.key === activeTab)?.label}</h2><p className="mt-1.5 text-xs leading-relaxed text-slate-400">{({ operations: "Set service hours and how long orders take to prepare.", delivery: "Set delivery fees, minimum orders and the areas you serve.", ai_brand: "Choose how your assistant speaks to customers.", contacts: "Keep your restaurant’s contact details up to date.", database: "Monitor your database connection and workspace data.", notifications: "Configure notifications and receipts for this device. Changes apply immediately." })[activeTab]}</p></div>
          {loading && <div className="ui-card flex items-center gap-2 p-5 text-xs text-slate-500"><RefreshCw size={15} className="animate-spin" />Loading your saved preferences...</div>}
          <fieldset disabled={loading || !!settingsError} className="min-w-0 disabled:opacity-50">
      {/* ─────────────────────────────────────────────────────────────
          TAB 1: STORE
         ───────────────────────────────────────────────────────────── */}
      {activeTab === "operations" && (
        <div className="ui-card p-5 sm:p-6 space-y-4">
          {/* Order Taking Status */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-slate-50/40 p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-slate-700">Order Taking</span>
              <span
                className={clsx(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                  settings.is_accepting_orders
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-100 text-amber-800"
                )}
              >
                {settings.is_accepting_orders ? "Live & Accepting" : "Paused"}
              </span>
              <span className="text-[11px] text-slate-400">AI informs customers when paused</span>
            </div>
            <button
              type="button"
              onClick={() => setSettings((curr) => ({ ...curr, is_accepting_orders: !curr.is_accepting_orders }))}
              className={clsx(
                "inline-flex items-center justify-center gap-1.5 rounded-lg h-8 px-3 text-xs font-bold transition shrink-0",
                settings.is_accepting_orders
                  ? "bg-brand text-white hover:bg-brand-hover"
                  : "bg-slate-800 text-white hover:bg-slate-900"
              )}
            >
              {settings.is_accepting_orders ? "Accepting (ON)" : "Paused (OFF)"}
            </button>
          </div>

          {/* Business Hours */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-700">Business Hours</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-4 space-y-1.5">
                <label htmlFor="settings-field-0" className="ui-label">Opening Time</label>
                <div className="flex items-center gap-2">
                  <Clock size={13} className="text-slate-400 shrink-0" />
                  <input id="settings-field-0"
                    type="time"
                    value={toTimeInputValue(settings.opening_time)}
                    onChange={(e) =>
                      setSettings((curr) => ({
                        ...curr,
                        opening_time: e.target.value ? toMeridiemLabel(e.target.value) : curr.opening_time,
                      }))
                    }
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:border-brand"
                  />
                </div>
                <p className="text-[11px] text-slate-400">Current: <span className="font-bold text-slate-600">{settings.opening_time}</span></p>
              </div>

              <div className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-4 space-y-1.5">
                <label htmlFor="settings-field-1" className="ui-label">Closing Time</label>
                <div className="flex items-center gap-2">
                  <Clock size={13} className="text-slate-400 shrink-0" />
                  <input id="settings-field-1"
                    type="time"
                    value={toTimeInputValue(settings.closing_time)}
                    onChange={(e) =>
                      setSettings((curr) => ({
                        ...curr,
                        closing_time: e.target.value ? toMeridiemLabel(e.target.value) : curr.closing_time,
                      }))
                    }
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:border-brand"
                  />
                </div>
                <p className="text-[11px] text-slate-400">Current: <span className="font-bold text-slate-600">{settings.closing_time}</span> · Overnight OK</p>
              </div>
            </div>
          </div>

          {/* Fulfillment Estimates */}
          <div className="border-t border-slate-100 pt-3 space-y-2">
            <p className="text-xs font-semibold text-slate-700">Fulfillment Estimates</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-4 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-slate-700">Kitchen Prep</span>
                  <span className="font-bold text-slate-900">{settings.estimated_prep_minutes} min</span>
                </div>
                <input
                  type="range"
                  aria-label="Kitchen preparation time in minutes"
                  min={10}
                  max={120}
                  step={5}
                  value={settings.estimated_prep_minutes}
                  onChange={(e) => setSettings((curr) => ({ ...curr, estimated_prep_minutes: Number(e.target.value) }))}
                  className="w-full accent-brand cursor-pointer"
                />
              </div>

              <div className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-4 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-slate-700">Rider Delivery</span>
                  <span className="font-bold text-slate-900">{settings.estimated_delivery_minutes} min</span>
                </div>
                <input
                  type="range"
                  aria-label="Delivery time in minutes"
                  min={15}
                  max={120}
                  step={5}
                  value={settings.estimated_delivery_minutes}
                  onChange={(e) => setSettings((curr) => ({ ...curr, estimated_delivery_minutes: Number(e.target.value) }))}
                  className="w-full accent-brand cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 2: DELIVERY
         ───────────────────────────────────────────────────────────── */}
      {activeTab === "delivery" && (
        <div className="ui-card p-5 sm:p-6 space-y-4">
          {/* Master Delivery Toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-slate-50/40 p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-slate-700">Delivery Service</span>
              <span
                className={clsx(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                  settings.delivery_enabled
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-slate-200 text-slate-700"
                )}
              >
                {settings.delivery_enabled ? "Enabled" : "Pickup Only"}
              </span>
              <span className="text-[11px] text-slate-400">
                {settings.delivery_enabled ? "Fee & min order rules apply" : "Bot accepts Pickup & Dine-in only"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSettings((curr) => ({ ...curr, delivery_enabled: !curr.delivery_enabled }))}
              className={clsx(
                "inline-flex items-center justify-center gap-1.5 rounded-lg h-8 px-3 text-xs font-bold transition shrink-0",
                settings.delivery_enabled
                  ? "bg-brand text-white hover:bg-brand-hover"
                  : "bg-slate-800 text-white hover:bg-slate-900"
              )}
            >
              {settings.delivery_enabled ? "Delivery ON" : "Enable Delivery"}
            </button>
          </div>

          {/* Pricing & Minimums */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-4 space-y-1.5">
              <label htmlFor="settings-field-2" className="ui-label">Delivery Fee (Rs.)</label>
              <input id="settings-field-2"
                type="number"
                min={0}
                step={50}
                value={settings.delivery_fee}
                onChange={(e) => setSettings((curr) => ({ ...curr, delivery_fee: Math.max(0, Number(e.target.value) || 0) }))}
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold text-slate-900 outline-none focus:border-brand"
                placeholder="0 for Free Delivery"
              />
              <p className="text-[11px] text-slate-400">Set 0 for free delivery</p>
            </div>

            <div className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-4 space-y-1.5">
              <label htmlFor="settings-field-3" className="ui-label">Min Order (Rs.)</label>
              <input id="settings-field-3"
                type="number"
                min={0}
                step={100}
                value={settings.min_delivery_amount}
                onChange={(e) => setSettings((curr) => ({ ...curr, min_delivery_amount: Math.max(0, Number(e.target.value) || 0) }))}
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold text-slate-900 outline-none focus:border-brand"
                placeholder="e.g. 500"
              />
              <p className="text-[11px] text-slate-400">Bot prompts to add more if below</p>
            </div>
          </div>

          {/* Delivery Area Restrictions */}
          <div className="border-t border-slate-100 pt-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-slate-700">Delivery Areas</p>
                <span className="text-[11px] text-slate-400">
                  {settings.delivery_areas.length === 0
                    ? "Anywhere — no restrictions"
                    : `${settings.delivery_areas.length} area${settings.delivery_areas.length > 1 ? "s" : ""} restricted`}
                </span>
              </div>
              {settings.delivery_areas.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSettings((curr) => ({ ...curr, delivery_areas: [] }))}
                  className="h-8 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 hover:bg-red-100"
                >
                  Clear All
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                  <CheckCircle2 size={11} /> Anywhere
                </span>
              )}
            </div>

            {/* Area Chips */}
            {settings.delivery_areas.length > 0 && (
              <div className="flex flex-wrap gap-1.5 p-2.5 rounded-lg border border-slate-200 bg-slate-50/50">
                {settings.delivery_areas.map((area, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-800"
                  >
                    <span>{area}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setSettings((curr) => ({
                          ...curr,
                          delivery_areas: curr.delivery_areas.filter((_, i) => i !== idx),
                        }))
                      }
                      className="text-slate-400 hover:text-red-600"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Input & Quick Presets */}
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Type area name and press Enter…"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none focus:border-brand focus:bg-white"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val && !settings.delivery_areas.includes(val)) {
                      setSettings((curr) => ({ ...curr, delivery_areas: [...curr.delivery_areas, val] }));
                      (e.target as HTMLInputElement).value = "";
                    }
                  }
                }}
              />

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase text-slate-400">Quick add:</span>
                {["Gulberg", "DHA Phase 1-6", "Bahria Town", "Johar Town", "Model Town", "F-6 / F-7", "Saddar", "Clifton"].map((preset) => {
                  const alreadyAdded = settings.delivery_areas.includes(preset);
                  return (
                    <button
                      key={preset}
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() =>
                        setSettings((curr) => ({
                          ...curr,
                          delivery_areas: [...curr.delivery_areas, preset],
                        }))
                      }
                      className={clsx(
                        "rounded-md px-2 py-0.5 text-[11px] font-semibold transition border",
                        alreadyAdded
                          ? "border-transparent bg-slate-100 text-slate-400 cursor-default"
                          : "border-slate-200 bg-white text-slate-700 hover:border-brand/40 hover:bg-brand/5 hover:text-brand"
                      )}
                    >
                      + {preset}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 3: AI VOICE
         ───────────────────────────────────────────────────────────── */}
      {activeTab === "ai_brand" && (
        <div className="ui-card p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Bot size={14} className="text-brand" />
            <p className="text-xs font-semibold text-slate-700">AI Personality &amp; Conversation Voice</p>
            <span className="text-[11px] text-slate-400">Tone injects into all customer interactions</span>
          </div>

          {/* Preset Cards */}
          <div className="grid gap-2 sm:grid-cols-2">
            {AI_PERSONALITY_PRESETS.map((preset) => {
              const isSelected = settings.ai_personality === preset.title;
              return (
                <button
                  type="button"
                  aria-pressed={isSelected}
                  key={preset.title}
                  onClick={() => setSettings((curr) => ({ ...curr, ai_personality: preset.title }))}
                  className={clsx(
                    "min-w-0 cursor-pointer rounded-lg border p-4 text-left transition-all",
                    isSelected
                      ? "border-brand bg-brand/5 ring-1 ring-brand/30"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900">{preset.title}</span>
                    {isSelected && <Check size={13} className="text-brand" />}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{preset.desc}</p>
                  {isSelected && (
                    <div className="mt-2 rounded-md bg-white p-2 border border-slate-100 text-[10px] text-slate-500 italic">
                      &ldquo;{preset.sample}&rdquo;
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Custom Personality Input */}
          <div className="border-t border-slate-100 pt-3 space-y-1.5">
            <label htmlFor="settings-field-4" className="ui-label">Custom Brand Voice</label>
            <input id="settings-field-4"
              type="text"
              value={settings.ai_personality}
              onChange={(e) => setSettings((curr) => ({ ...curr, ai_personality: e.target.value }))}
              placeholder="e.g. Energetic & Hospitable Karachi Street Food style"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none focus:border-brand focus:bg-white"
            />
            <p className="text-[11px] text-slate-400">Type custom instructions to uniquely define your AI tone.</p>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 4: CONTACT
         ───────────────────────────────────────────────────────────── */}
      {activeTab === "contacts" && (
        <div className="ui-card p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-slate-700">Contact Numbers &amp; City</p>
            <span className="text-[11px] text-slate-400">Shared with customers on request</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-4 space-y-1.5">
              <label htmlFor="settings-field-5" className="ui-label">City</label>
              <select id="settings-field-5"
                value={selectedCityOption}
                onChange={(e) =>
                  setSettings((curr) => ({
                    ...curr,
                    city: e.target.value === "__custom__" ? curr.city : e.target.value,
                  }))
                }
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:border-brand"
              >
                {cityOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="__custom__">Custom City</option>
              </select>
            </div>

            {selectedCityOption === "__custom__" && (
              <div className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-4 space-y-1.5">
                <label htmlFor="settings-field-6" className="ui-label">Custom City Name</label>
                <input id="settings-field-6"
                  type="text"
                  value={settings.city}
                  onChange={(e) => setSettings((curr) => ({ ...curr, city: e.target.value }))}
                  className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:border-brand"
                  placeholder="e.g. Faisalabad"
                />
              </div>
            )}

            <div className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-4 space-y-1.5">
              <label htmlFor="settings-field-7" className="ui-label">Delivery Hotline</label>
              <input id="settings-field-7"
                type="text"
                value={settings.phone_delivery}
                onChange={(e) => setSettings((curr) => ({ ...curr, phone_delivery: e.target.value }))}
                placeholder="e.g. +92 300 1234567"
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:border-brand"
              />
            </div>

            <div className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-4 space-y-1.5">
              <label htmlFor="settings-field-8" className="ui-label">Dine-in / Reservation</label>
              <input id="settings-field-8"
                type="text"
                value={settings.phone_dine_in}
                onChange={(e) => setSettings((curr) => ({ ...curr, phone_dine_in: e.target.value }))}
                placeholder="e.g. 042-111-222-333"
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:border-brand"
              />
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 5: DATABASE
         ───────────────────────────────────────────────────────────── */}
      {activeTab === "database" && (
        <div className="ui-card p-5 sm:p-6 space-y-4">
          {/* Connection Health Header */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <Database size={14} />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-semibold text-slate-700">Supabase PostgreSQL</p>
                  <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {dbStats?.database.status?.toUpperCase() || "CONNECTED"}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Latency: <span className="font-mono font-bold text-slate-700">{dbStats?.database.ping_latency_ms ?? 120}ms</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => void loadDatabaseStats()}
                disabled={loadingDbStats}
                className="inline-flex items-center gap-1.5 h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw size={12} className={clsx(loadingDbStats && "animate-spin text-brand")} />
                Refresh
              </button>
              <button
                onClick={() => void handlePurgeCache()}
                disabled={purgingCache}
                className="inline-flex items-center gap-1.5 h-8 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {purgingCache ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Flush Cache
              </button>
            </div>
          </div>

          {/* Table Record Counts — 3-col consistent grid */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Table Record Counts</p>
            <div className="grid grid-cols-3 gap-2 lg:grid-cols-5">
              {[
                { table: "orders", label: "Orders", count: dbStats?.table_counts.orders ?? 0, sub: `${dbStats?.table_counts.active_orders ?? 0} active` },
                { table: "conversations", label: "Conversations", count: dbStats?.table_counts.conversations ?? 0, sub: "WA threads" },
                { table: "messages", label: "Messages", count: dbStats?.table_counts.messages ?? 0, sub: "in + out" },
                { table: "contacts", label: "CRM", count: dbStats?.table_counts.contacts ?? 0, sub: "profiles" },
                { table: "menu_items", label: "Menu", count: dbStats?.table_counts.menu_items ?? 0, sub: "items" },
                { table: "agent_turns", label: "AI Turns", count: dbStats?.table_counts.agent_turns ?? 0, sub: "NLU logs" },
                { table: "webhook_events", label: "Webhooks", count: dbStats?.table_counts.webhook_events ?? 0, sub: "Meta API" },
                { table: "staff_alerts", label: "Alerts", count: dbStats?.table_counts.staff_alerts ?? 0, sub: `${dbStats?.table_counts.unread_alerts ?? 0} unread` },
                { table: "rate_limits", label: "Throttles", count: dbStats?.table_counts.rate_limits ?? 0, sub: "IP blocks" },
                { table: "cache", label: "Cache", count: dbStats?.cache.active_entries ?? 0, sub: "in-memory" },
              ].map((item) => (
                <div key={item.table} className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{item.label}</p>
                  <p className="mt-0.5 text-lg font-bold text-slate-900">{item.count}</p>
                  <p className="text-[10px] text-slate-400">{item.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 6: ALERTS
         ───────────────────────────────────────────────────────────── */}
      {activeTab === "notifications" && (
        <div className="ui-card p-5 sm:p-6 divide-y divide-slate-100 space-y-0">
          {/* Audio Alerts Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-slate-700">Chime Sound</span>
              <span
                className={clsx(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                  isSoundEnabled
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-slate-200 text-slate-700"
                )}
              >
                {isSoundEnabled ? "Enabled" : "Muted"}
              </span>
              <span className="text-[11px] text-slate-400">Plays on new customer message</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={playTestSound}
                className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Test Chime
              </button>
              <button
                type="button"
                onClick={toggleSoundEnabled}
                className={clsx(
                  "inline-flex items-center gap-1.5 h-8 rounded-lg px-3 text-xs font-bold transition",
                  isSoundEnabled
                    ? "bg-brand text-white hover:bg-brand-hover"
                    : "bg-slate-800 text-white hover:bg-slate-900"
                )}
              >
                {isSoundEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
                {isSoundEnabled ? "Sound ON" : "Muted"}
              </button>
            </div>
          </div>

          {/* Auto-Print Toggle Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Printer size={13} className="text-slate-500 shrink-0" />
              <span className="text-xs font-semibold text-slate-700">Auto-Print Orders</span>
              <span
                className={clsx(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                  isAutoPrintEnabled
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-slate-200 text-slate-700"
                )}
              >
                {isAutoPrintEnabled ? "Active" : "Disabled"}
              </span>
              <span className="text-[11px] text-slate-400">Sends to Windows default printer on confirm</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleTestPrint}
                disabled={testingPrint}
                className="inline-flex items-center gap-1.5 h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
              >
                <Printer size={12} className={testingPrint ? "animate-pulse text-brand" : "text-slate-500"} />
                {testingPrint ? "Sending…" : "Test Print"}
              </button>
              <button
                type="button"
                onClick={toggleAutoPrintEnabled}
                className={clsx(
                  "inline-flex items-center gap-1.5 h-8 rounded-lg px-3 text-xs font-bold transition",
                  isAutoPrintEnabled
                    ? "bg-brand text-white hover:bg-brand-hover"
                    : "bg-slate-800 text-white hover:bg-slate-900"
                )}
              >
                <Printer size={13} />
                {isAutoPrintEnabled ? "Auto-Print ON" : "Auto-Print OFF"}
              </button>
            </div>
          </div>

          {/* Paper Width Selector Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-700">Paper Roll Width</span>
              <span className="text-[11px] text-slate-400">Match your thermal printer roll</span>
            </div>
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
              <button
                type="button"
                onClick={() => setReceiptPaperWidth("80mm")}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                  receiptPaperWidth === "80mm"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                )}
              >
                80mm (Standard)
              </button>
              <button
                type="button"
                onClick={() => setReceiptPaperWidth("58mm")}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                  receiptPaperWidth === "58mm"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                )}
              >
                58mm (Compact)
              </button>
            </div>
          </div>

          {/* Silent Printing Info */}
          <div className="rounded-lg border border-sky-100 bg-sky-50/70 p-3 mt-1 space-y-1">
            <div className="text-[11px] font-semibold text-sky-950 flex items-center gap-1">
              <span>💡 Zero-Click Silent Printing</span>
            </div>
            <p className="text-[11px] text-sky-800">
              • Prints to your <strong>Windows Default Printer</strong> — no driver config needed.
            </p>
            <p className="text-[11px] text-sky-800">
              • Skip print dialog: launch Chrome/Edge with{" "}
              <code className="rounded bg-sky-100 px-1 py-0.5 font-mono text-[10px] text-sky-900 border border-sky-200">
                chrome.exe --kiosk-printing
              </code>
            </p>
          </div>
        </div>
      )}
          </fieldset>
        </div>
      </div>
    </div>
  );
}
