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
  Sparkles,
  Zap,
  Building2,
  Check,
  AlertTriangle,
  Server,
  Layers,
  Activity,
  Trash2,
  Sliders,
  ShieldCheck,
} from "lucide-react";
import { clsx } from "clsx";
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";
import { PageHeader } from "@/app/components/dashboard/PageHeader";
import { toast } from "sonner";
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
    profile,
    selectedBranchId,
    selectedBranch,
    isSoundEnabled,
    toggleSoundEnabled,
  } = useDashboardContext();

  const [activeTab, setActiveTab] = useState<SettingsTab>("operations");
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

  const settingsUrl = useMemo(
    () => (selectedBranchId === "all" ? null : `/api/settings?branch_id=${encodeURIComponent(selectedBranchId)}`),
    [selectedBranchId]
  );

  const { data: cachedSettings, isLoading: loading } = useDataCache<Partial<SettingsState>>(settingsUrl);

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
    if (activeTab === "database") {
      void loadDatabaseStats();
    }
  }, [activeTab, loadDatabaseStats]);

  const cityOptions = useMemo(
    () => [...new Set([profile.city, ...CITY_OPTIONS].map((city) => city.trim()).filter(Boolean))],
    [profile.city]
  );

  const selectedCityOption = cityOptions.includes(settings.city) ? settings.city : "__custom__";

  async function save() {
    if (selectedBranchId === "all") return;

    setSaving(true);
    try {
      const response = await fetch(`/api/settings?branch_id=${encodeURIComponent(selectedBranchId)}`, {
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

  const tabs: { key: SettingsTab; label: string; icon: React.ReactNode; badge?: string }[] = [
    { key: "operations", label: "Store & Hours", icon: <Store size={15} /> },
    { key: "delivery", label: "Delivery & Zones", icon: <Truck size={15} />, badge: settings.delivery_enabled ? "ON" : "OFF" },
    { key: "ai_brand", label: "AI Tone & Voice", icon: <Bot size={15} /> },
    { key: "contacts", label: "Contact & Location", icon: <Phone size={15} /> },
    { key: "database", label: "Database & Stats", icon: <Database size={15} /> },
    { key: "notifications", label: "Alerts & Audio", icon: <Bell size={15} /> },
  ];

  if (selectedBranchId === "all") {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Store Settings"
          description="Branch-level operations, delivery zones, AI tone, and database insights."
        />
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-900 shadow-sm">
          <Building2 size={32} className="mx-auto mb-2 text-amber-600" />
          <h3 className="font-bold text-base">Select a Specific Branch</h3>
          <p className="text-xs text-amber-700 mt-1 max-w-md mx-auto">
            You are currently viewing &ldquo;All Branches&rdquo;. Please choose a specific location from the top branch switcher to edit its operational rules and settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header with Save Button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Branch Settings</h1>
            {selectedBranch && (
              <span className="rounded-full bg-brand/10 text-brand px-2.5 py-0.5 text-xs font-bold">
                {selectedBranch.name}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure operational hours, delivery rules, AI voice persona, and inspect database metrics.
          </p>
        </div>

        <div className="flex w-full sm:w-auto items-center gap-2">
          {activeTab !== "database" && (
            <button
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-brand-hover disabled:opacity-50"
            >
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
              <span>Save Changes</span>
            </button>
          )}
        </div>
      </div>

      {/* WhatsApp Integration Shortcut Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white font-bold shrink-0">
            <Phone size={18} />
          </div>
          <div>
            <h4 className="text-xs sm:text-sm font-bold text-emerald-950">WhatsApp Bot & QR Connection Hub</h4>
            <p className="text-[11px] text-emerald-700">Scan QR codes, connect phone numbers, and monitor gateway status directly.</p>
          </div>
        </div>
        <Link
          href="/dashboard/whatsapp"
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition-colors shrink-0"
        >
          Manage WhatsApp
        </Link>
      </div>

      {/* Categorized Tab Navigation Bar */}
      <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {tabs.map(({ key, label, icon, badge }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={clsx(
              "flex shrink-0 items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all sm:flex-1 sm:px-4 sm:py-2.5",
              activeTab === key
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            )}
          >
            {icon}
            <span>{label}</span>
            {badge && (
              <span
                className={clsx(
                  "rounded px-1.5 py-0.2 text-[9px] font-bold",
                  badge === "ON"
                    ? activeTab === key ? "bg-emerald-500 text-white" : "bg-emerald-100 text-emerald-800"
                    : activeTab === key ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"
                )}
              >
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ─────────────────────────────────────────────────────────────
          TAB 1: STORE & HOURS OPERATIONS
         ───────────────────────────────────────────────────────────── */}
      {activeTab === "operations" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm space-y-6">
            {/* Accepting orders banner switch */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 text-sm">Store Order Taking Status</span>
                  <span
                    className={clsx(
                      "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase",
                      settings.is_accepting_orders
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800"
                    )}
                  >
                    {settings.is_accepting_orders ? "Live & Accepting" : "Paused"}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  When paused, the AI informs customers that the kitchen is temporarily not taking new orders.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSettings((curr) => ({ ...curr, is_accepting_orders: !curr.is_accepting_orders }))}
                className={clsx(
                  "inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition",
                  settings.is_accepting_orders
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-slate-800 text-white hover:bg-slate-900"
                )}
              >
                {settings.is_accepting_orders ? "Accepting Orders (ON)" : "Orders Paused (OFF)"}
              </button>
            </div>

            {/* Operating Hours */}
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Business Operating Hours</h3>
              <p className="text-xs text-slate-400 mb-4">
                The bot enforces these hours when telling customers whether the restaurant is currently open.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">Opening Time</label>
                  <div className="flex items-center gap-2">
                    <Clock size={16} className="text-slate-400" />
                    <input
                      type="time"
                      value={toTimeInputValue(settings.opening_time)}
                      onChange={(e) =>
                        setSettings((curr) => ({
                          ...curr,
                          opening_time: e.target.value ? toMeridiemLabel(e.target.value) : curr.opening_time,
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-brand"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">Current: <span className="font-bold">{settings.opening_time}</span></p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">Closing Time</label>
                  <div className="flex items-center gap-2">
                    <Clock size={16} className="text-slate-400" />
                    <input
                      type="time"
                      value={toTimeInputValue(settings.closing_time)}
                      onChange={(e) =>
                        setSettings((curr) => ({
                          ...curr,
                          closing_time: e.target.value ? toMeridiemLabel(e.target.value) : curr.closing_time,
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-brand"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">Current: <span className="font-bold">{settings.closing_time}</span> (Overnight supported)</p>
                </div>
              </div>
            </div>

            {/* Preparation Estimates */}
            <div className="border-t border-slate-100 pt-5">
              <h3 className="text-sm font-bold text-slate-900 mb-1">Fulfillment Time Estimates</h3>
              <p className="text-xs text-slate-400 mb-4">Estimated duration communicated to customers for preparation and delivery.</p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-slate-700">Kitchen Prep Time</span>
                    <span className="font-bold text-slate-900">{settings.estimated_prep_minutes} minutes</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={120}
                    step={5}
                    value={settings.estimated_prep_minutes}
                    onChange={(e) => setSettings((curr) => ({ ...curr, estimated_prep_minutes: Number(e.target.value) }))}
                    className="w-full accent-brand cursor-pointer"
                  />
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-slate-700">Rider Delivery Time</span>
                    <span className="font-bold text-slate-900">{settings.estimated_delivery_minutes} minutes</span>
                  </div>
                  <input
                    type="range"
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
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 2: DELIVERY & ZONES
         ───────────────────────────────────────────────────────────── */}
      {activeTab === "delivery" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm space-y-6">
          {/* Master Delivery Toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 text-sm">Delivery Service</span>
                <span
                  className={clsx(
                    "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase",
                    settings.delivery_enabled
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-slate-200 text-slate-700"
                  )}
                >
                  {settings.delivery_enabled ? "Enabled" : "Disabled (Pickup Only)"}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {settings.delivery_enabled
                  ? "Customers can place delivery orders. Delivery fee and minimum order rules apply."
                  : "Delivery is disabled. The bot will only accept Pickup and Dine-in orders."}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setSettings((curr) => ({ ...curr, delivery_enabled: !curr.delivery_enabled }))}
              className={clsx(
                "inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition",
                settings.delivery_enabled
                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                  : "bg-slate-800 text-white hover:bg-slate-900"
              )}
            >
              {settings.delivery_enabled ? "Delivery is Active (ON)" : "Enable Delivery"}
            </button>
          </div>

          {/* Pricing & Minimums */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-1.5">
              <label className="text-xs font-bold text-slate-700">Delivery Fee (Rs.)</label>
              <input
                type="number"
                min={0}
                step={50}
                value={settings.delivery_fee}
                onChange={(e) => setSettings((curr) => ({ ...curr, delivery_fee: Math.max(0, Number(e.target.value) || 0) }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-brand"
                placeholder="0 for Free Delivery"
              />
              <p className="text-[11px] text-slate-500">Set 0 for Free Delivery</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-1.5">
              <label className="text-xs font-bold text-slate-700">Minimum Order Amount (Rs.)</label>
              <input
                type="number"
                min={0}
                step={100}
                value={settings.min_delivery_amount}
                onChange={(e) => setSettings((curr) => ({ ...curr, min_delivery_amount: Math.max(0, Number(e.target.value) || 0) }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-brand"
                placeholder="e.g. 500"
              />
              <p className="text-[11px] text-slate-500">Orders below this amount will prompt the user to add more items</p>
            </div>
          </div>

          {/* Delivery Area Restrictions */}
          <div className="border-t border-slate-100 pt-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Delivery Areas & Restrictions</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {settings.delivery_areas.length === 0
                    ? "Deliver Anywhere — No location restrictions active."
                    : `Restricted to ${settings.delivery_areas.length} area${settings.delivery_areas.length > 1 ? "s" : ""}.`}
                </p>
              </div>

              {settings.delivery_areas.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSettings((curr) => ({ ...curr, delivery_areas: [] }))}
                  className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                >
                  Remove Restrictions (Deliver Anywhere)
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
                  <CheckCircle2 size={12} /> Deliver Anywhere
                </span>
              )}
            </div>

            {/* Area Chips */}
            {settings.delivery_areas.length > 0 && (
              <div className="flex flex-wrap gap-1.5 p-3 rounded-xl border border-slate-200 bg-slate-50/50">
                {settings.delivery_areas.map((area, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 shadow-sm"
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
                placeholder="Type an area name (e.g. DHA Phase 5, Gulberg III) and press Enter..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-800 outline-none focus:border-brand focus:bg-white"
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

              <div className="flex flex-wrap items-center gap-1.5 pt-1">
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
          TAB 3: AI BRAND VOICE & PERSONALITY
         ───────────────────────────────────────────────────────────── */}
      {activeTab === "ai_brand" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm space-y-6">
          <div>
            <div className="flex items-center gap-2">
              <Bot size={18} className="text-brand" />
              <h3 className="text-base font-bold text-slate-900">AI Personality & Conversation Voice</h3>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Select how your AI assistant speaks to customers on WhatsApp. The tone dynamically injects into all customer interactions.
            </p>
          </div>

          {/* Preset Cards */}
          <div className="grid gap-3 sm:grid-cols-2">
            {AI_PERSONALITY_PRESETS.map((preset) => {
              const isSelected = settings.ai_personality === preset.title;
              return (
                <div
                  key={preset.title}
                  onClick={() => setSettings((curr) => ({ ...curr, ai_personality: preset.title }))}
                  className={clsx(
                    "cursor-pointer rounded-xl border p-4 transition-all",
                    isSelected
                      ? "border-brand bg-brand/5 ring-1 ring-brand/30"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 text-sm">{preset.title}</span>
                    {isSelected && <Check size={16} className="text-brand" />}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{preset.desc}</p>
                  <div className="mt-3 rounded-lg bg-white p-2 border border-slate-100 text-[11px] text-slate-600 italic">
                    &ldquo;{preset.sample}&rdquo;
                  </div>
                </div>
              );
            })}
          </div>

          {/* Custom Personality Input */}
          <div className="border-t border-slate-100 pt-5 space-y-2">
            <label className="text-xs font-bold text-slate-700">Custom Brand Voice Guidelines</label>
            <input
              type="text"
              value={settings.ai_personality}
              onChange={(e) => setSettings((curr) => ({ ...curr, ai_personality: e.target.value }))}
              placeholder="e.g. Energetic & Hospitable Karachi Street Food style"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-800 outline-none focus:border-brand focus:bg-white"
            />
            <p className="text-[11px] text-slate-400">
              Type custom phrasing or instructions to uniquely customize your AI assistant tone.
            </p>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 4: CONTACT & LOCATION
         ───────────────────────────────────────────────────────────── */}
      {activeTab === "contacts" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm space-y-5">
          <div>
            <h3 className="text-base font-bold text-slate-900">Contact Numbers & City</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              These details are provided to customers when they ask for direct helpline or dine-in reservations.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-1.5">
              <label className="text-xs font-bold text-slate-700">City</label>
              <select
                value={selectedCityOption}
                onChange={(e) =>
                  setSettings((curr) => ({
                    ...curr,
                    city: e.target.value === "__custom__" ? curr.city : e.target.value,
                  }))
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-brand"
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
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-1.5">
                <label className="text-xs font-bold text-slate-700">Custom City Name</label>
                <input
                  type="text"
                  value={settings.city}
                  onChange={(e) => setSettings((curr) => ({ ...curr, city: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-brand"
                  placeholder="e.g. Faisalabad"
                />
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-1.5">
              <label className="text-xs font-bold text-slate-700">Delivery Support Hotline</label>
              <input
                type="text"
                value={settings.phone_delivery}
                onChange={(e) => setSettings((curr) => ({ ...curr, phone_delivery: e.target.value }))}
                placeholder="e.g. +92 300 1234567"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-brand"
              />
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-1.5">
              <label className="text-xs font-bold text-slate-700">Dine-in / Reservation Phone</label>
              <input
                type="text"
                value={settings.phone_dine_in}
                onChange={(e) => setSettings((curr) => ({ ...curr, phone_dine_in: e.target.value }))}
                placeholder="e.g. 042-111-222-333"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-brand"
              />
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 5: DATABASE & SYSTEM INSIGHTS (NEW!)
         ───────────────────────────────────────────────────────────── */}
      {activeTab === "database" && (
        <div className="space-y-6">
          {/* Connection Health Banner */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                  <Database size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">Supabase PostgreSQL Engine</h3>
                    <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      {dbStats?.database.status?.toUpperCase() || "CONNECTED"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Cloud Database Connection &bull; Latency: <span className="font-mono font-bold text-slate-800">{dbStats?.database.ping_latency_ms ?? 120}ms</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => void loadDatabaseStats()}
                  disabled={loadingDbStats}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw size={13} className={clsx(loadingDbStats && "animate-spin text-brand")} />
                  <span>Refresh Telemetry</span>
                </button>
                <button
                  onClick={() => void handlePurgeCache()}
                  disabled={purgingCache}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                >
                  {purgingCache ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  <span>Flush Cache</span>
                </button>
              </div>
            </div>

            {/* Live Database Table Record Counts */}
            <div className="mt-6">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Database Table Record Counts</h4>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {[
                  { table: "orders", label: "Orders (Total)", count: dbStats?.table_counts.orders ?? 0, sub: `${dbStats?.table_counts.active_orders ?? 0} active` },
                  { table: "conversations", label: "Conversations", count: dbStats?.table_counts.conversations ?? 0, sub: "WhatsApp threads" },
                  { table: "messages", label: "Messages", count: dbStats?.table_counts.messages ?? 0, sub: "inbound & outbound" },
                  { table: "contacts", label: "Customer CRM", count: dbStats?.table_counts.contacts ?? 0, sub: "saved profiles" },
                  { table: "menu_items", label: "Menu Catalog", count: dbStats?.table_counts.menu_items ?? 0, sub: "dishes & variants" },
                  { table: "agent_turns", label: "AI Agent Turns", count: dbStats?.table_counts.agent_turns ?? 0, sub: "NLU logs" },
                  { table: "webhook_events", label: "Webhook Events", count: dbStats?.table_counts.webhook_events ?? 0, sub: "Meta WhatsApp API" },
                  { table: "staff_alerts", label: "Staff Alerts", count: dbStats?.table_counts.staff_alerts ?? 0, sub: `${dbStats?.table_counts.unread_alerts ?? 0} unread` },
                  { table: "rate_limits", label: "Security Throttles", count: dbStats?.table_counts.rate_limits ?? 0, sub: "active IP blocks" },
                  { table: "cache", label: "Cache Size", count: dbStats?.cache.active_entries ?? 0, sub: "in-memory records" },
                ].map((item) => (
                  <div key={item.table} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{item.label}</p>
                    <p className="mt-1 text-xl font-bold text-slate-900">{item.count}</p>
                    <p className="text-[10px] text-slate-500">{item.sub}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 6: NOTIFICATIONS & AUDIO
         ───────────────────────────────────────────────────────────── */}
      {activeTab === "notifications" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm space-y-6">
          <div>
            <h3 className="text-base font-bold text-slate-900">Audio Alerts & Notification Preferences</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Control browser sounds when new customer WhatsApp messages or orders arrive.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 text-sm">Dashboard Chime Sound</span>
                <span
                  className={clsx(
                    "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase",
                    isSoundEnabled
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-slate-200 text-slate-700"
                  )}
                >
                  {isSoundEnabled ? "Enabled" : "Muted"}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Plays a pleasant sound chime when a new message arrives from a customer.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={playTestSound}
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Play Test Chime
              </button>
              <button
                type="button"
                onClick={toggleSoundEnabled}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition",
                  isSoundEnabled
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-slate-800 text-white hover:bg-slate-900"
                )}
              >
                {isSoundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                <span>{isSoundEnabled ? "Sound ON" : "Sound Muted"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
