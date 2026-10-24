"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { clsx } from "clsx";
import {
  Loader2,
  LogOut,
  Trash2,
  GitBranch,
  Users,
  ShieldAlert,
  Plus,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Building2,
  Eye,
  Save,
  AlertTriangle,
  Palette,
  Bot,
  Activity,
  Cpu,
  Sparkles,
  RefreshCw,
  Zap,
  Check,
  Terminal,
  Radio,
  Image as ImageIcon,
  Smartphone,
  UploadCloud,
  ExternalLink,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useDashboardContext } from "./DashboardProvider";
import { useDataCache, invalidateCache } from "@/lib/useDataCache";
import type { RestaurantProfile } from "@/lib/restaurant-profile-types";

type Tab = "restaurants" | "branding" | "branches" | "staff" | "ai_config" | "diagnostics" | "safety";

type BranchSummary = {
  id: string;
  slug: string;
  name: string;
  city: string;
  address: string;
  is_active: boolean;
  stats: {
    conversations: number;
    unread: number;
    activeOrders: number;
    menuItems: number;
  };
};

type StaffSummary = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: "admin" | "branch_staff";
  default_branch_id: string | null;
  allowed_branch_ids: string[];
};

type BranchDraft = { name: string; slug: string; city: string; address: string; is_active: "active" | "inactive" };
type StaffDraft = { full_name: string; email: string; password: string; role: "admin" | "branch_staff"; branch_id: string };

const EMPTY_BRANCH: BranchDraft = { name: "", slug: "", city: "", address: "", is_active: "active" };
const EMPTY_STAFF: StaffDraft = { full_name: "", email: "", password: "", role: "branch_staff", branch_id: "" };
const WIPE_ALL_CONFIRMATION = "WIPE ALL OPERATIONAL DATA";
const MIN_STAFF_PASSWORD_LENGTH = 8;

function branchWipeConfirmation(branchId: string) {
  return `WIPE BRANCH ${branchId}`;
}

async function readJson<T>(response: Response) {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body as T;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1.5">
      {children}
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-100 transition-all";
const selectCls = inputCls;

function colorInputValue(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#EA580C";
}

export default function AdminConsole() {
  const { session, profile, setProfile, selectedBranchId, selectedBranch, setSelectedBranchId, logout } = useDashboardContext();
  const [tab, setTab] = useState<Tab>(session.role === "super_admin" ? "restaurants" : "branding");
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [profileDraft, setProfileDraft] = useState<RestaurantProfile>(profile);

  // Super Admin Tenant Management State
  const [restaurants, setRestaurants] = useState<any[]>([]);
  const [loadingRestaurants, setLoadingRestaurants] = useState(false);
  const [showNewRestaurantModal, setShowNewRestaurantModal] = useState(false);
  const [creatingRestaurant, setCreatingRestaurant] = useState(false);
  const [newRestaurant, setNewRestaurant] = useState({
    name: "",
    city: "Islamabad",
    brandColor: "#EA580C",
    logoUrl: "",
    supportPhone: "",
    aiPersonality: "Warm & Professional",
    menuDisplayMode: "interactive_list" as "interactive_list" | "menu_pictures" | "text_only",
    primaryBranchName: "Main Branch",
    primaryBranchAddress: "",
    adminFullName: "",
    adminEmail: "",
    adminPassword: "",
  });

  const loadRestaurants = useCallback(async () => {
    setLoadingRestaurants(true);
    try {
      const res = await fetch("/api/admin/restaurants");
      if (res.ok) {
        const data = await res.json();
        setRestaurants(data);
      }
    } catch {
      toast.error("Failed to load restaurants.");
    } finally {
      setLoadingRestaurants(false);
    }
  }, []);

  useEffect(() => {
    if (session.role === "super_admin") {
      void loadRestaurants();
    }
  }, [session.role, loadRestaurants]);

  async function handleCreateNewRestaurant(e: React.FormEvent) {
    e.preventDefault();
    if (!newRestaurant.name.trim()) {
      toast.error("Restaurant name is required.");
      return;
    }
    if (!newRestaurant.adminEmail.trim() || !newRestaurant.adminPassword.trim()) {
      toast.error("Admin email and password are required.");
      return;
    }
    if (newRestaurant.adminPassword.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }

    setCreatingRestaurant(true);
    try {
      const res = await fetch("/api/admin/restaurants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newRestaurant),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create restaurant.");

      toast.success(data.message || `Restaurant "${newRestaurant.name}" created! 🎉`);
      setShowNewRestaurantModal(false);
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create restaurant.");
    } finally {
      setCreatingRestaurant(false);
    }
  }

  async function handleSwitchTenant(restaurantId: string) {
    try {
      const res = await fetch("/api/admin/switch-restaurant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId }),
      });
      if (!res.ok) throw new Error("Failed to switch restaurant.");
      toast.success("Switched active restaurant!");
      window.location.reload();
    } catch {
      toast.error("Failed to switch restaurant.");
    }
  }

  const [creatingBranch, setCreatingBranch] = useState(false);
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingBranchId, setSavingBranchId] = useState<string | null>(null);
  const [savingStaffId, setSavingStaffId] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [branchDraft, setBranchDraft] = useState<BranchDraft>(EMPTY_BRANCH);
  const [staffDraft, setStaffDraft] = useState<StaffDraft>(EMPTY_STAFF);
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [expandedBranch, setExpandedBranch] = useState<string | null>(null);
  const [expandedStaff, setExpandedStaff] = useState<string | null>(null);

  // Menu card images upload state
  const [uploadingMenuImages, setUploadingMenuImages] = useState(false);
  const menuFileInputRef = useRef<HTMLInputElement | null>(null);
  const [showManualUrlInput, setShowManualUrlInput] = useState(false);
  const [manualUrlInput, setManualUrlInput] = useState("");

  // Diagnostics state
  const [diagnosticsData, setDiagnosticsData] = useState<{
    metrics: {
      total_recent_turns: number;
      avg_latency_ms: number;
      success_rate: number;
      fallback_count: number;
      escalated_count: number;
      webhook_status_counts: Record<string, number>;
      active_rate_limits: number;
    };
    turns: Array<{
      id: string;
      conversation_id: string;
      turn_seq: number;
      channel: string;
      user_message: string;
      system_response: string;
      stage_before: string;
      stage_after: string;
      detected_intent: string;
      confidence_score: number;
      model_name: string;
      provider: string;
      latency_ms: number;
      used_semantic_search: boolean;
      result_status: string;
      error_message: string | null;
      created_at: string;
    }>;
    webhooks: Array<{
      id: string;
      provider: string;
      event_type: string;
      status: string;
      retry_count: number;
      error_message: string | null;
      created_at: string;
      processed_at: string | null;
    }>;
  } | null>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);
  const [expandedTurnId, setExpandedTurnId] = useState<string | null>(null);

  // AI sandbox test state
  const [sandboxPrompt, setSandboxPrompt] = useState("bhai 2 chicken biryani aur 1 sprite bhej do gulberg me");
  const [sandboxResult, setSandboxResult] = useState<{
    intent: string;
    confidence: number;
    extractedItems: string[];
    addressDetected: string;
    stage: string;
  } | null>(null);
  const [simulatingAi, setSimulatingAi] = useState(false);

  const loadDiagnostics = useCallback(async () => {
    setLoadingDiagnostics(true);
    try {
      const res = await fetch("/api/admin/diagnostics?limit=50");
      if (res.ok) {
        const data = await res.json();
        setDiagnosticsData(data);
      }
    } catch {
      toast.error("Failed to load diagnostics");
    } finally {
      setLoadingDiagnostics(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "diagnostics") {
      void loadDiagnostics();
    }
  }, [tab, loadDiagnostics]);

  const totals = useMemo(() => {
    return branches.reduce(
      (acc, branch) => ({
        branchCount: acc.branchCount + 1,
        activeOrders: acc.activeOrders + branch.stats.activeOrders,
        unread: acc.unread + branch.stats.unread,
        menuItems: acc.menuItems + branch.stats.menuItems,
      }),
      { branchCount: 0, activeOrders: 0, unread: 0, menuItems: 0 },
    );
  }, [branches]);

  // Stale-while-revalidate for admin data
  const { data: cachedBranches, isLoading: branchesLoading, revalidate: revalidateBranches } =
    useDataCache<BranchSummary[]>("/api/admin/branches");
  const { data: cachedStaff, isLoading: staffLoading, revalidate: revalidateStaff } =
    useDataCache<StaffSummary[]>("/api/admin/staff");
  const { data: cachedProfile, isLoading: profileLoading, revalidate: revalidateProfile } =
    useDataCache<RestaurantProfile>("/api/admin/restaurant-profile");

  const loading = branchesLoading || staffLoading || profileLoading;

  useEffect(() => { if (cachedBranches) setBranches(cachedBranches); }, [cachedBranches]);
  useEffect(() => { if (cachedStaff) setStaff(cachedStaff); }, [cachedStaff]);
  useEffect(() => { if (cachedProfile) setProfileDraft(cachedProfile); }, [cachedProfile]);

  function invalidateAdminCache() {
    invalidateCache("/api/admin/branches");
    invalidateCache("/api/admin/staff");
    invalidateCache("/api/admin/restaurant-profile");
  }

  function reloadData() {
    invalidateAdminCache();
    revalidateBranches();
    revalidateStaff();
    revalidateProfile();
  }

  function updateProfileDraft<K extends keyof RestaurantProfile>(key: K, value: RestaurantProfile[K]) {
    setProfileDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveProfile() {
    setSavingProfile(true);
    try {
      const updated = await readJson<RestaurantProfile>(
        await fetch("/api/admin/restaurant-profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(profileDraft),
        }),
      );
      setProfileDraft(updated);
      setProfile(updated);
      if (updated.branch_mode !== "multiple" && selectedBranchId === "all") {
        setSelectedBranchId(updated.default_branch_id ?? branches.find((branch) => branch.is_active)?.id ?? "all");
      }
      document.documentElement.style.setProperty("--brand", updated.brand_color);
      document.documentElement.style.setProperty("--brand-hover", updated.brand_hover_color);
      invalidateCache("/api/admin/restaurant-profile");
      toast.success("Restaurant profile saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save restaurant profile.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleMenuImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadingMenuImages(true);
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append("files", files[i]);
    }

    try {
      const res = await fetch("/api/admin/menu-images", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to upload menu images.");

      updateProfileDraft("menu_card_images", data.allImages);
      setProfile({ ...profileDraft, menu_card_images: data.allImages });
      invalidateCache("/api/admin/restaurant-profile");
      toast.success(`Uploaded ${data.uploadedCount} menu card${data.uploadedCount > 1 ? "s" : ""} to storage & synced with database!`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to upload menu images.");
    } finally {
      setUploadingMenuImages(false);
      if (menuFileInputRef.current) menuFileInputRef.current.value = "";
    }
  }

  async function handleDeleteMenuImage(imageUrl: string) {
    try {
      const res = await fetch("/api/admin/menu-images", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete image.");

      updateProfileDraft("menu_card_images", data.allImages);
      setProfile({ ...profileDraft, menu_card_images: data.allImages });
      invalidateCache("/api/admin/restaurant-profile");
      toast.success("Menu card image removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete image.");
    }
  }

  function handleAddManualUrl() {
    const url = manualUrlInput.trim();
    if (!url) return;
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      toast.error("Please enter a valid HTTP/HTTPS URL.");
      return;
    }
    const current = Array.isArray(profileDraft.menu_card_images) ? [...profileDraft.menu_card_images] : [];
    if (current.includes(url)) {
      toast.error("This image URL is already added.");
      return;
    }
    const updated = [...current, url];
    updateProfileDraft("menu_card_images", updated);
    setManualUrlInput("");
    toast.success("Image URL added to draft. Click 'Save Profile' to persist.");
  }

  if (session.role !== "admin" && session.role !== "super_admin") return null;

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    ...(session.role === "super_admin"
      ? [{ key: "restaurants" as Tab, label: "Client Tenants", icon: <Building2 size={15} /> }]
      : []),
    { key: "branding", label: "Branding", icon: <Palette size={15} /> },
    { key: "branches", label: "Branches", icon: <GitBranch size={15} /> },
    { key: "staff", label: "Staff", icon: <Users size={15} /> },
    { key: "ai_config", label: "AI Tuning", icon: <Bot size={15} /> },
    { key: "diagnostics", label: "Diagnostics", icon: <Activity size={15} /> },
    { key: "safety", label: "Danger Zone", icon: <ShieldAlert size={15} /> },
  ];

  return (
    <div className="space-y-3 pb-10">
      {/* Compact header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-bold text-slate-900">Admin Console</h1>
          <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-brand">
            <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse" />
            {session.role === "super_admin" ? "Super Admin" : "Admin"}
          </span>
        </div>
        <button
          onClick={() => void logout()}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
        >
          <LogOut size={13} />
          Sign Out
        </button>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Branches", value: totals.branchCount, sub: `${branches.filter((b) => b.is_active).length} active` },
          { label: "Staff", value: staff.length, sub: `${staff.filter((s) => s.role === "admin").length} admins` },
          { label: "Unread", value: totals.unread, sub: "across branches" },
          { label: "Orders", value: totals.activeOrders, sub: "currently active" },
        ].map((m) => (
          <div key={m.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{m.label}</p>
            <p className="mt-0.5 text-xl font-bold text-slate-900">{m.value}</p>
            <p className="text-[10px] text-slate-400">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* Tab Navigation */}
      <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {tabs.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all sm:flex-1 sm:justify-center whitespace-nowrap",
              tab === key
                ? key === "safety"
                  ? "bg-red-600 text-white shadow-sm"
                  : "bg-zinc-900 text-white shadow-sm"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-700",
            )}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {/* ────────── CLIENT TENANTS TAB (SUPER ADMIN) ────────── */}
      {tab === "restaurants" && session.role === "super_admin" && (
        <section className="space-y-6">
          {/* Header Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900">Client Restaurant Tenants</h2>
                  <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-bold text-purple-800">
                    {restaurants.length} {restaurants.length === 1 ? "Client" : "Clients"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Manage multi-tenant client accounts. Create client credentials, configure custom logos, menu styles, and switch directly into any client&apos;s dashboard view to finalize configuration.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadRestaurants()}
                  disabled={loadingRestaurants}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                  title="Refresh clients list"
                >
                  <RefreshCw size={13} className={clsx(loadingRestaurants && "animate-spin")} />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewRestaurantModal(true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-purple-700 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-purple-800"
                >
                  <Plus size={15} />
                  Onboard New Restaurant
                </button>
              </div>
            </div>
          </div>

          {/* Tenants Grid or Empty State */}
          {loadingRestaurants ? (
            <div className="flex h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white">
              <Loader2 size={24} className="animate-spin text-purple-600" />
            </div>
          ) : restaurants.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-8 text-center sm:p-12">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-50 text-purple-600">
                <Building2 size={28} />
              </div>
              <h3 className="mt-4 text-base font-bold text-slate-900">No Restaurant Clients Yet</h3>
              <p className="mx-auto mt-1.5 max-w-md text-xs text-slate-500">
                You haven&apos;t onboarded any restaurant clients yet. Create your first client with custom branding, initial branches, and administrator credentials.
              </p>
              <button
                type="button"
                onClick={() => setShowNewRestaurantModal(true)}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-purple-700 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-purple-800"
              >
                <Plus size={15} />
                Onboard First Restaurant
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {restaurants.map((rest) => {
                const isCurrent = rest.id === session.restaurantId;
                const branchCount = rest.branches?.length ?? 0;
                const hasWhatsApp = rest.whatsapp_configs?.length > 0;

                return (
                  <div
                    key={rest.id}
                    className={clsx(
                      "flex flex-col justify-between rounded-2xl border bg-white p-5 shadow-xs transition-all",
                      isCurrent
                        ? "border-purple-500 ring-2 ring-purple-100"
                        : "border-slate-200 hover:border-slate-300"
                    )}
                  >
                    <div>
                      {/* Top Row: Brand Color & Active Status */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="h-4 w-4 rounded-full border border-black/10 shadow-2xs shrink-0"
                            style={{ backgroundColor: rest.brand_color || "#EA580C" }}
                            title={`Brand color: ${rest.brand_color}`}
                          />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            {rest.city || "Pakistan"}
                          </span>
                        </div>
                        {isCurrent ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-0.5 text-[10px] font-bold text-purple-800">
                            <span className="h-1.5 w-1.5 rounded-full bg-purple-600 animate-pulse" />
                            Currently Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            Active Tenant
                          </span>
                        )}
                      </div>

                      {/* Restaurant Title & Slug */}
                      <div className="mt-3.5 flex items-start gap-3">
                        {rest.logo_url ? (
                          <img
                            src={rest.logo_url}
                            alt={rest.name}
                            className="h-11 w-11 rounded-xl border border-slate-100 object-cover shrink-0 bg-slate-50"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-purple-50 text-purple-700 shrink-0 font-bold text-base">
                            {rest.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-bold text-slate-900 text-sm sm:text-base">
                            {rest.name}
                          </h3>
                          <p className="truncate text-[11px] text-slate-400 font-mono">
                            /{rest.slug}
                          </p>
                        </div>
                      </div>

                      {/* Meta Pills */}
                      <div className="mt-4 flex flex-wrap gap-2 text-xs">
                        <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600">
                          <GitBranch size={12} className="text-slate-400" />
                          <span>{branchCount} {branchCount === 1 ? "branch" : "branches"}</span>
                        </div>
                        <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600">
                          <Radio size={12} className={hasWhatsApp ? "text-emerald-500" : "text-slate-400"} />
                          <span>{hasWhatsApp ? "WhatsApp Live" : "WhatsApp Pending"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Bottom Action */}
                    <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-[10px] text-slate-400">
                        ID: <span className="font-mono">{rest.id.slice(0, 8)}...</span>
                      </span>
                      {isCurrent ? (
                        <span className="text-xs font-semibold text-purple-700">
                          Viewing this restaurant
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleSwitchTenant(rest.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-bold text-purple-700 transition hover:bg-purple-100"
                        >
                          Switch Dashboard
                          <ChevronRight size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ────────── BRANDING TAB ────────── */}
      {tab === "branding" && (
        <section className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Restaurant Profile</h2>
                <p className="mt-1 text-xs text-slate-400">
                  Controls the dashboard brand, WhatsApp identity, and whether customers see branch selection.
                </p>
              </div>
              <button
                onClick={() => void saveProfile()}
                disabled={savingProfile}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
              >
                {savingProfile ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Profile
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Field label="Restaurant Name">
                <input value={profileDraft.app_name} onChange={(event) => updateProfileDraft("app_name", event.target.value)} className={inputCls} placeholder="Restaurant name" />
              </Field>
              <Field label="Dashboard Title">
                <input value={profileDraft.dashboard_title} onChange={(event) => updateProfileDraft("dashboard_title", event.target.value)} className={inputCls} placeholder="Management Dashboard" />
              </Field>
              <Field label="Logo URL">
                <input value={profileDraft.logo_url ?? ""} onChange={(event) => updateProfileDraft("logo_url", event.target.value || null)} className={inputCls} placeholder="https://..." />
              </Field>
              <Field label="Default City">
                <input value={profileDraft.city} onChange={(event) => updateProfileDraft("city", event.target.value)} className={inputCls} placeholder="City" />
              </Field>
              <Field label="Brand Color">
                <div className="flex gap-2">
                  <input type="color" value={colorInputValue(profileDraft.brand_color)} onChange={(event) => updateProfileDraft("brand_color", event.target.value.toUpperCase())} className="h-10 w-12 rounded-lg border border-slate-200 bg-white p-1" />
                  <input value={profileDraft.brand_color} onChange={(event) => updateProfileDraft("brand_color", event.target.value)} className={inputCls} />
                </div>
              </Field>
              <Field label="Hover Color">
                <div className="flex gap-2">
                  <input type="color" value={colorInputValue(profileDraft.brand_hover_color)} onChange={(event) => updateProfileDraft("brand_hover_color", event.target.value.toUpperCase())} className="h-10 w-12 rounded-lg border border-slate-200 bg-white p-1" />
                  <input value={profileDraft.brand_hover_color} onChange={(event) => updateProfileDraft("brand_hover_color", event.target.value)} className={inputCls} />
                </div>
              </Field>
              <Field label="Currency Label">
                <input value={profileDraft.currency} onChange={(event) => updateProfileDraft("currency", event.target.value)} className={inputCls} placeholder="Rs." />
              </Field>
              <Field label="Timezone">
                <input value={profileDraft.timezone} onChange={(event) => updateProfileDraft("timezone", event.target.value)} className={inputCls} placeholder="Asia/Karachi" />
              </Field>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
                  <GitBranch size={16} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Location Mode</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    Single location keeps branch IDs internally but hides branch choice from customers and staff.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  { value: "single", title: "Single location", body: "Use this for restaurants with no branches or one main outlet." },
                  { value: "multiple", title: "Multiple branches", body: "Customers choose city and branch before ordering." },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => updateProfileDraft("branch_mode", option.value as RestaurantProfile["branch_mode"])}
                    className={clsx(
                      "rounded-xl border p-4 text-left transition-colors",
                      profileDraft.branch_mode === option.value
                        ? "border-zinc-900 bg-zinc-950 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300",
                    )}
                  >
                    <span className="block text-sm font-bold">{option.title}</span>
                    <span className={clsx("mt-1 block text-xs", profileDraft.branch_mode === option.value ? "text-zinc-400" : "text-slate-400")}>
                      {option.body}
                    </span>
                  </button>
                ))}
              </div>

              <div className="mt-4">
                <Field label="Primary Branch">
                  <select value={profileDraft.default_branch_id ?? ""} onChange={(event) => updateProfileDraft("default_branch_id", event.target.value || null)} className={selectCls}>
                    <option value="">First active branch</option>
                    {branches.filter((branch) => branch.is_active).map((branch) => (
                      <option key={branch.id} value={branch.id}>{branch.name}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
                  <Users size={16} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Contact & Voice Defaults</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    Used when branch-level settings are missing and in global dashboard copy.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-4">
                <Field label="Support Phone">
                  <input value={profileDraft.support_phone} onChange={(event) => updateProfileDraft("support_phone", event.target.value)} className={inputCls} />
                </Field>
                <Field label="Delivery Phone">
                  <input value={profileDraft.delivery_phone} onChange={(event) => updateProfileDraft("delivery_phone", event.target.value)} className={inputCls} />
                </Field>
                <Field label="Dine-in Phone">
                  <input value={profileDraft.dine_in_phone} onChange={(event) => updateProfileDraft("dine_in_phone", event.target.value)} className={inputCls} />
                </Field>
                <Field label="Default AI Tone">
                  <textarea value={profileDraft.ai_personality_default} onChange={(event) => updateProfileDraft("ai_personality_default", event.target.value)} rows={3} className={clsx(inputCls, "resize-none")} />
                </Field>
              </div>
            </div>
          </div>

          {/* Menu Display & WhatsApp Engine Configuration */}
          <div className="grid gap-5 lg:grid-cols-2">
            {/* Menu Display Mode */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-600 text-white">
                  <ImageIcon size={16} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Menu Display Format</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    Configure what happens when a customer asks for the menu or deals via WhatsApp.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {[
                  {
                    value: "interactive_list",
                    title: "Interactive List",
                    body: "Interactive category buttons & picker lists in WhatsApp.",
                  },
                  {
                    value: "menu_pictures",
                    title: "Menu Pictures",
                    body: "Directly sends high-res menu cards & deals pictures (Cheezo Bites style).",
                  },
                  {
                    value: "text_only",
                    title: "Text Only",
                    body: "Plain text formatted items and prices without widgets.",
                  },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={async () => {
                      const nextMode = option.value as RestaurantProfile["menu_display_mode"];
                      updateProfileDraft("menu_display_mode", nextMode);
                      try {
                        await fetch("/api/admin/restaurant-profile", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ menu_display_mode: nextMode }),
                        });
                        invalidateCache("/api/admin/restaurant-profile");
                        toast.success(`Display mode saved: ${option.title}`);
                      } catch (err) {
                        toast.error("Failed to auto-save display mode.");
                      }
                    }}
                    className={clsx(
                      "rounded-xl border p-3.5 text-left transition-colors flex flex-col justify-between",
                      (profileDraft.menu_display_mode || "interactive_list") === option.value
                        ? "border-orange-600 bg-orange-50/70 text-orange-950 font-medium"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300",
                    )}
                  >
                    <div>
                      <span className="block text-xs font-bold text-slate-900">{option.title}</span>
                      <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">
                        {option.body}
                      </span>
                    </div>
                    {(profileDraft.menu_display_mode || "interactive_list") === option.value && (
                      <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-orange-600 uppercase tracking-wider">
                        <Check size={12} /> Selected
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Menu Card Images when menu_pictures is enabled */}
              {profileDraft.menu_display_mode === "menu_pictures" && (
                <div className="mt-5 rounded-xl border border-orange-200 bg-orange-50/50 p-4 space-y-4">
                  {/* Hidden file input supporting multiple images */}
                  <input
                    ref={menuFileInputRef}
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp,image/jpg"
                    className="hidden"
                    onChange={handleMenuImageUpload}
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <FieldLabel>Menu Card Pictures ({Array.isArray(profileDraft.menu_card_images) ? profileDraft.menu_card_images.length : 0} configured)</FieldLabel>
                      <p className="text-[11px] text-slate-500">
                        Upload your full menu cards or deals photos. When customers say &quot;menu&quot; or tap &quot;View Menu&quot;, the agent sends <strong>all</strong> of these pictures.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => menuFileInputRef.current?.click()}
                        disabled={uploadingMenuImages}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-orange-700 disabled:opacity-50 transition-all"
                      >
                        {uploadingMenuImages ? (
                          <>
                            <Loader2 size={13} className="animate-spin" /> Uploading...
                          </>
                        ) : (
                          <>
                            <UploadCloud size={14} /> Upload Pictures
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowManualUrlInput(!showManualUrlInput)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                      >
                        {showManualUrlInput ? "Hide URL Input" : "Add by URL"}
                      </button>
                    </div>
                  </div>

                  {/* Manual URL entry if needed */}
                  {showManualUrlInput && (
                    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2">
                      <input
                        type="url"
                        value={manualUrlInput}
                        onChange={(e) => setManualUrlInput(e.target.value)}
                        placeholder="https://your-domain.com/menu-card.jpg"
                        className={clsx(inputCls, "py-1.5 text-xs")}
                      />
                      <button
                        type="button"
                        onClick={handleAddManualUrl}
                        className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
                      >
                        Add URL
                      </button>
                    </div>
                  )}

                  {/* Upload Dropzone / Banner */}
                  <div
                    onClick={() => !uploadingMenuImages && menuFileInputRef.current?.click()}
                    className={clsx(
                      "flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center cursor-pointer transition-all",
                      uploadingMenuImages
                        ? "border-orange-400 bg-orange-100/50 cursor-not-allowed"
                        : "border-orange-300 bg-white/80 hover:border-orange-500 hover:bg-white",
                    )}
                  >
                    {uploadingMenuImages ? (
                      <div className="flex items-center gap-2 text-sm font-medium text-orange-700">
                        <Loader2 size={18} className="animate-spin" /> Uploading to Supabase Storage & syncing DB...
                      </div>
                    ) : (
                      <>
                        <UploadCloud size={24} className="text-orange-600 mb-1" />
                        <span className="text-xs font-semibold text-slate-800">
                          Click to select multiple menu pictures
                        </span>
                        <span className="text-[11px] text-slate-400 mt-0.5">
                          Supports JPG, PNG, WebP (up to 10MB per file)
                        </span>
                      </>
                    )}
                  </div>

                  {/* Visual Gallery of Menu Cards */}
                  {Array.isArray(profileDraft.menu_card_images) && profileDraft.menu_card_images.length > 0 ? (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                        Active Menu Cards ({profileDraft.menu_card_images.length})
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {profileDraft.menu_card_images.map((url, idx) => (
                          <div
                            key={url}
                            className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs transition-all hover:shadow-md"
                          >
                            <div className="relative h-32 w-full bg-slate-100">
                              <img
                                src={url}
                                alt={`Menu Card ${idx + 1}`}
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                              <span className="absolute top-1.5 left-1.5 rounded-md bg-zinc-950/75 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-xs">
                                Card #{idx + 1}
                              </span>
                            </div>

                            <div className="flex items-center justify-between p-2 text-xs">
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 truncate text-[11px] text-slate-500 hover:text-slate-800"
                                title="Open full image"
                              >
                                <ExternalLink size={11} /> View Full
                              </a>
                              <button
                                type="button"
                                onClick={() => handleDeleteMenuImage(url)}
                                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-50 transition-colors"
                                title="Remove menu card"
                              >
                                <Trash2 size={12} /> Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 border border-amber-200/60">
                      ⚠️ <strong>No menu cards uploaded yet.</strong> Click &quot;Upload Pictures&quot; above to select and upload your restaurant&apos;s menu cards.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* WhatsApp Gateway Engine */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white">
                  <Smartphone size={16} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">WhatsApp Gateway Provider</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    Choose which messaging transport layer powers this restaurant&apos;s AI agent.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  {
                    value: "meta",
                    title: "Meta Cloud API (Official)",
                    badge: "Coexistence Active",
                    body: "Official Meta WhatsApp Business Cloud API with Embedded Signup, Coexistence, and Webhooks.",
                  },
                  {
                    value: "evolution",
                    title: "Evolution API",
                    badge: "QR or pairing code",
                    body: "Connect a dedicated WhatsApp instance for this restaurant from your existing dashboard.",
                  },
                  {
                    value: "none",
                    title: "Disabled",
                    badge: "Off",
                    body: "WhatsApp automation disabled for this project instance.",
                  },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      updateProfileDraft(
                        "whatsapp_provider",
                        option.value as RestaurantProfile["whatsapp_provider"],
                      )
                    }
                    className={clsx(
                      "rounded-xl border p-3.5 text-left transition-colors flex flex-col justify-between",
                      (profileDraft.whatsapp_provider || "none") === option.value
                        ? "border-emerald-600 bg-emerald-50/70 text-emerald-950 font-medium"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300",
                    )}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="block text-xs font-bold text-slate-900">{option.title}</span>
                      </div>
                      <span className="mt-1 inline-block rounded bg-slate-200/70 px-1.5 py-0.5 text-[9px] font-bold text-slate-600 uppercase">
                        {option.badge}
                      </span>
                      <span className="mt-1.5 block text-[11px] leading-relaxed text-slate-500">
                        {option.body}
                      </span>
                    </div>
                    {(profileDraft.whatsapp_provider || "none") === option.value && (
                      <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 uppercase tracking-wider">
                        <Check size={12} /> Active
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 space-y-1">
                <p className="font-semibold text-slate-800">Connection status:</p>
                <p>
                  To manage QR codes, pairing codes, or Meta webhooks for this provider, head over to the{" "}
                  <a href="/dashboard/whatsapp" className="font-semibold text-orange-600 hover:underline">
                    WhatsApp Gateway Manager
                  </a>.
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {tab === "branches" && (
        <section className="space-y-5">
          {/* Create Branch Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-white">
                <Plus size={15} />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Create Branch</h2>
                <p className="text-xs text-slate-400">Add a new location to the network</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <Field label="Branch Name">
                <input value={branchDraft.name} onChange={(e) => setBranchDraft((c) => ({ ...c, name: e.target.value }))} placeholder="e.g. Downtown Outlet" className={inputCls} />
              </Field>
              <Field label="URL Slug">
                <input value={branchDraft.slug} onChange={(e) => setBranchDraft((c) => ({ ...c, slug: e.target.value }))} placeholder="auto-generated if empty" className={inputCls} />
              </Field>
              <Field label="City">
                <input value={branchDraft.city} onChange={(e) => setBranchDraft((c) => ({ ...c, city: e.target.value }))} placeholder="e.g. Lahore" className={inputCls} />
              </Field>
              <Field label="Status">
                <select value={branchDraft.is_active} onChange={(e) => setBranchDraft((c) => ({ ...c, is_active: e.target.value as "active" | "inactive" }))} className={selectCls}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
            </div>
            <div className="mt-4 grid items-end gap-3 md:grid-cols-[1fr_auto]">
              <Field label="Address">
                <textarea value={branchDraft.address} onChange={(e) => setBranchDraft((c) => ({ ...c, address: e.target.value }))} placeholder="Full address" rows={2} className={clsx(inputCls, "resize-none")} />
              </Field>
              <button
                onClick={async () => {
                  setCreatingBranch(true);
                  try {
                    await readJson(
                      await fetch("/api/admin/branches", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          ...branchDraft,
                          is_active: branchDraft.is_active === "active",
                          slug: branchDraft.slug || null,
                        }),
                      }),
                    );
                    setBranchDraft(EMPTY_BRANCH);
                    toast.success("Branch created successfully.");
                    reloadData();
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Failed to create branch.");
                  } finally {
                    setCreatingBranch(false);
                  }
                }}
                disabled={creatingBranch || !branchDraft.name.trim() || !branchDraft.city.trim()}
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-40 md:h-[72px] md:min-w-[140px]"
              >
                {creatingBranch ? <Loader2 size={16} className="animate-spin" /> : <><Plus size={14} /> Create Branch</>}
              </button>
            </div>
          </div>

          {/* Branches List */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
              <div>
                <h2 className="text-base font-bold text-slate-900">Manage Branches</h2>
                <p className="text-xs text-slate-400 mt-0.5">{branches.length} branch{branches.length !== 1 ? "es" : ""} total</p>
              </div>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
                {branches.filter((b) => b.is_active).length} Active
              </span>
            </div>

            {loading && (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-50" />
                ))}
              </div>
            )}

            {!loading && branches.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Building2 size={32} className="text-slate-300 mb-3" />
                <p className="text-sm font-semibold text-slate-400">No branches yet</p>
                <p className="text-xs text-slate-300 mt-1">Create your first branch above</p>
              </div>
            )}

            {!loading && branches.map((branch, idx) => {
              const isExpanded = expandedBranch === branch.id;
              const isSaving = savingBranchId === branch.id;
              return (
                <div key={branch.id} className={clsx("border-slate-100", idx < branches.length - 1 && "border-b")}>
                  {/* Collapsed Row */}
                  <div
                    className="group flex cursor-pointer items-center gap-3 px-4 py-4 transition-colors hover:bg-slate-50 sm:gap-4 sm:px-6"
                    onClick={() => setExpandedBranch(isExpanded ? null : branch.id)}
                  >
                    <div className={clsx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold", branch.is_active ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-400")}>
                      {branch.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900 truncate">{branch.name}</p>
                        <span className={clsx("shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", branch.is_active ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500")}>
                          {branch.is_active ? <CheckCircle2 size={9} /> : <XCircle size={9} />}
                          {branch.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-400">{branch.city} - {branch.address || "No address"}</p>
                    </div>
                    <div className="hidden md:flex items-center gap-3 text-xs text-slate-400 shrink-0">
                      <span className="rounded-md bg-slate-100 px-2.5 py-1 font-medium">{branch.stats.conversations} chats</span>
                      <span className="rounded-md bg-orange-50 text-orange-700 px-2.5 py-1 font-medium">{branch.stats.activeOrders} orders</span>
                      <span className="rounded-md bg-slate-100 px-2.5 py-1 font-medium">{branch.stats.menuItems} items</span>
                    </div>
                    <ChevronRight size={16} className={clsx("text-slate-300 group-hover:text-slate-500 transition-all shrink-0", isExpanded && "rotate-90")} />
                  </div>

                  {/* Expanded Edit Panel */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-slate-50/50 px-4 pb-5 sm:px-6">
                      <div className="pt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                        <Field label="Branch Name">
                          <input value={branch.name} onChange={(e) => setBranches((c) => c.map((b) => b.id === branch.id ? { ...b, name: e.target.value } : b))} className={inputCls} />
                        </Field>
                        <Field label="Slug">
                          <input value={branch.slug} onChange={(e) => setBranches((c) => c.map((b) => b.id === branch.id ? { ...b, slug: e.target.value } : b))} className={inputCls} />
                        </Field>
                        <Field label="City">
                          <input value={branch.city} onChange={(e) => setBranches((c) => c.map((b) => b.id === branch.id ? { ...b, city: e.target.value } : b))} className={inputCls} />
                        </Field>
                        <Field label="Status">
                          <select value={branch.is_active ? "active" : "inactive"} onChange={(e) => setBranches((c) => c.map((b) => b.id === branch.id ? { ...b, is_active: e.target.value === "active" } : b))} className={selectCls}>
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                          </select>
                        </Field>
                        <Field label="Address">
                          <input value={branch.address} onChange={(e) => setBranches((c) => c.map((b) => b.id === branch.id ? { ...b, address: e.target.value } : b))} className={inputCls} />
                        </Field>
                      </div>
                      <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
                        <button
                          onClick={() => setSelectedBranchId(branch.id)}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
                        >
                          <Eye size={12} /> Focus Branch
                        </button>
                        <button
                          onClick={async () => {
                            setSavingBranchId(branch.id);
                            try {
                              await readJson(await fetch(`/api/admin/branches/${branch.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: branch.name, slug: branch.slug, city: branch.city, address: branch.address, is_active: branch.is_active }) }));
                              toast.success("Branch saved.");
                              reloadData();
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : "Failed to save branch.");
                            } finally {
                              setSavingBranchId(null);
                            }
                          }}
                          disabled={isSaving}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
                        >
                          {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                          Save Changes
                        </button>
                        <button
                          onClick={async () => {
                            if (!window.confirm(`Delete "${branch.name}"? This action cannot be undone.`)) return;
                            setSavingBranchId(branch.id);
                            try {
                              await readJson(await fetch(`/api/admin/branches/${branch.id}`, { method: "DELETE" }));
                              toast.success("Branch deleted.");
                              reloadData();
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : "Failed to delete branch.");
                            } finally {
                              setSavingBranchId(null);
                            }
                          }}
                          disabled={isSaving}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 sm:ml-auto"
                        >
                          <Trash2 size={12} /> Delete Branch
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ────────── STAFF TAB ────────── */}
      {tab === "staff" && (
        <section className="space-y-5">
          {/* Create Staff Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-white">
                <Plus size={15} />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Create Staff Account</h2>
                <p className="text-xs text-slate-400">Add a new team member with role-based access</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Full Name">
                <input value={staffDraft.full_name} onChange={(e) => setStaffDraft((c) => ({ ...c, full_name: e.target.value }))} placeholder="Jane Smith" className={inputCls} />
              </Field>
              <Field label="Email Address">
                <input type="email" value={staffDraft.email} onChange={(e) => setStaffDraft((c) => ({ ...c, email: e.target.value }))} placeholder="jane@company.com" className={inputCls} />
              </Field>
              <Field label="Initial Password">
                <input type="password" value={staffDraft.password} onChange={(e) => setStaffDraft((c) => ({ ...c, password: e.target.value }))} placeholder="Minimum 8 characters" className={inputCls} />
              </Field>
              <Field label="Role">
                <select value={staffDraft.role} onChange={(e) => setStaffDraft((c) => ({ ...c, role: e.target.value as "admin" | "branch_staff", branch_id: e.target.value === "admin" ? "" : c.branch_id }))} className={selectCls}>
                  <option value="branch_staff">Branch Staff</option>
                  <option value="admin">Admin</option>
                </select>
              </Field>
              {staffDraft.role === "branch_staff" && (
                <div className="md:col-span-2">
                  <Field label="Assigned Branch">
                    <select value={staffDraft.branch_id} onChange={(e) => setStaffDraft((c) => ({ ...c, branch_id: e.target.value }))} className={selectCls}>
                      <option value="">Select a branch…</option>
                      {branches.filter((b) => b.is_active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </Field>
                </div>
              )}
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {staffDraft.role === "admin" && (
                <p className="text-xs text-amber-600 flex items-center gap-1.5">
                  <AlertTriangle size={12} /> Admin accounts have full system access
                </p>
              )}
              <div className="w-full sm:ml-auto sm:w-auto">
                <button
                  onClick={async () => {
                    setCreatingStaff(true);
                    try {
                      await readJson(await fetch("/api/admin/staff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ full_name: staffDraft.full_name, email: staffDraft.email, password: staffDraft.password, role: staffDraft.role, default_branch_id: staffDraft.role === "branch_staff" ? staffDraft.branch_id : null, branch_ids: staffDraft.role === "branch_staff" && staffDraft.branch_id ? [staffDraft.branch_id] : [] }) }));
                      setStaffDraft(EMPTY_STAFF);
                      toast.success("Staff account created.");
                      reloadData();
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Failed to create staff.");
                    } finally {
                      setCreatingStaff(false);
                    }
                  }}
                  disabled={
                    creatingStaff ||
                    !staffDraft.full_name.trim() ||
                    !staffDraft.email.trim() ||
                    staffDraft.password.trim().length < MIN_STAFF_PASSWORD_LENGTH ||
                    (staffDraft.role === "branch_staff" && !staffDraft.branch_id)
                  }
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-40 sm:w-auto"
                >
                  {creatingStaff ? <Loader2 size={14} className="animate-spin" /> : <><Plus size={14} /> Create Account</>}
                </button>
              </div>
            </div>
          </div>

          {/* Staff List */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                <h2 className="text-base font-bold text-slate-900">Staff Directory</h2>
                <p className="text-xs text-slate-400 mt-0.5">{staff.length} member{staff.length !== 1 ? "s" : ""}</p>
              </div>
              <div className="flex gap-2 text-xs">
                <span className="rounded-full bg-purple-50 text-purple-700 px-2.5 py-1 font-semibold">{staff.filter((s) => s.role === "admin").length} admins</span>
                <span className="rounded-full bg-blue-50 text-blue-700 px-2.5 py-1 font-semibold">{staff.filter((s) => s.role === "branch_staff").length} staff</span>
              </div>
            </div>

            {loading && (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-50" />)}
              </div>
            )}

            {!loading && staff.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Users size={32} className="text-slate-300 mb-3" />
                <p className="text-sm font-semibold text-slate-400">No staff accounts yet</p>
              </div>
            )}

            {!loading && staff.map((member, idx) => {
              const assignedBranchId = member.allowed_branch_ids[0] ?? "";
              const isExpanded = expandedStaff === member.user_id;
              const isSaving = savingStaffId === member.user_id;
              const isSelf = member.user_id === session.userId;
              const initials = (member.full_name || member.email || "?").slice(0, 2).toUpperCase();
              const branchName = branches.find((b) => b.id === assignedBranchId)?.name;

              return (
                <div key={member.user_id} className={clsx("border-slate-100", idx < staff.length - 1 && "border-b")}>
                  {/* Collapsed Row */}
                  <div
                    className="group flex cursor-pointer items-center gap-3 px-4 py-4 transition-colors hover:bg-slate-50 sm:gap-4 sm:px-6"
                    onClick={() => setExpandedStaff(isExpanded ? null : member.user_id)}
                  >
                    <div className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold", member.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-blue-50 text-blue-700")}>
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-slate-900 truncate">{member.full_name || "Unnamed"}</p>
                        {isSelf && <span className="text-[10px] font-semibold rounded-full bg-orange-50 text-orange-600 px-2 py-0.5">You</span>}
                        <span className={clsx("text-[10px] font-semibold rounded-full px-2 py-0.5", member.role === "admin" ? "bg-purple-50 text-purple-700" : "bg-blue-50 text-blue-600")}>
                          {member.role === "admin" ? "Admin" : "Branch Staff"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 truncate mt-0.5">
                        {member.email || "No email"}{branchName ? ` · ${branchName}` : ""}
                      </p>
                    </div>
                    <ChevronRight size={16} className={clsx("text-slate-300 group-hover:text-slate-500 transition-all shrink-0", isExpanded && "rotate-90")} />
                  </div>

                  {/* Expanded Edit Panel */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-slate-50/50 px-4 pb-5 sm:px-6">
                      <div className="pt-5 grid gap-4 md:grid-cols-3">
                        <Field label="Full Name">
                          <input value={member.full_name ?? ""} onChange={(e) => setStaff((c) => c.map((s) => s.user_id === member.user_id ? { ...s, full_name: e.target.value } : s))} className={inputCls} />
                        </Field>
                        <div>
                          <FieldLabel>Email Address</FieldLabel>
                          <div className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2.5 text-sm text-slate-400 cursor-not-allowed select-none truncate">
                            {member.email || "No email"}
                          </div>
                        </div>
                        <Field label="Role">
                          <select value={member.role} onChange={(e) => setStaff((c) => c.map((s) => s.user_id === member.user_id ? { ...s, role: e.target.value as "admin" | "branch_staff", allowed_branch_ids: e.target.value === "admin" ? [] : s.allowed_branch_ids, default_branch_id: e.target.value === "admin" ? null : s.default_branch_id } : s))} className={selectCls} disabled={isSelf}>
                            <option value="branch_staff">Branch Staff</option>
                            <option value="admin">Admin</option>
                          </select>
                        </Field>
                      </div>

                      {member.role === "branch_staff" && (
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <Field label="Assigned Branch">
                            <select value={assignedBranchId} onChange={(e) => setStaff((c) => c.map((s) => s.user_id === member.user_id ? { ...s, allowed_branch_ids: e.target.value ? [e.target.value] : [], default_branch_id: e.target.value || null } : s))} className={selectCls}>
                              <option value="">No branch assigned</option>
                              {branches.filter((b) => b.is_active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                          </Field>
                          <Field label="Primary Branch">
                            <select value={member.default_branch_id ?? ""} onChange={(e) => setStaff((c) => c.map((s) => s.user_id === member.user_id ? { ...s, default_branch_id: e.target.value || null } : s))} className={selectCls}>
                              <option value="">Same as assigned</option>
                              {branches.filter((b) => b.id === assignedBranchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                          </Field>
                        </div>
                      )}

                      <div className="mt-4">
                        <Field label="New Password (optional)">
                          <input type="password" value={passwordDrafts[member.user_id] ?? ""} onChange={(e) => setPasswordDrafts((c) => ({ ...c, [member.user_id]: e.target.value }))} placeholder="Leave blank to keep current password" className={clsx(inputCls, "md:max-w-xs")} />
                        </Field>
                      </div>

                      <div className="mt-5 grid gap-2 sm:flex sm:flex-wrap">
                        <button
                          onClick={async () => {
                            setSavingStaffId(member.user_id);
                            try {
                              await readJson(await fetch(`/api/admin/staff/${member.user_id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ full_name: member.full_name ?? "", role: member.role, default_branch_id: member.role === "branch_staff" ? member.default_branch_id ?? assignedBranchId : null, branch_ids: member.role === "branch_staff" && assignedBranchId ? [assignedBranchId] : [], password: (passwordDrafts[member.user_id] || "").trim() || null }) }));
                              setPasswordDrafts((c) => ({ ...c, [member.user_id]: "" }));
                              toast.success("Staff updated.");
                              reloadData();
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : "Failed to update staff.");
                            } finally {
                              setSavingStaffId(null);
                            }
                          }}
                          disabled={isSaving}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
                        >
                          {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                          Save Changes
                        </button>
                        <button
                          onClick={async () => {
                            if (!window.confirm(`Delete account for "${member.full_name || member.email}"? This cannot be undone.`)) return;
                            setSavingStaffId(member.user_id);
                            try {
                              await readJson(await fetch(`/api/admin/staff/${member.user_id}`, { method: "DELETE" }));
                              toast.success("Staff account deleted.");
                              reloadData();
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : "Failed to delete staff.");
                            } finally {
                              setSavingStaffId(null);
                            }
                          }}
                          disabled={isSaving || isSelf}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40 sm:ml-auto"
                          title={isSelf ? "You cannot delete your own account" : undefined}
                        >
                          <Trash2 size={12} /> Delete Account
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ────────── AI TUNING TAB ────────── */}
      {tab === "ai_config" && (
        <section className="space-y-6">
          {/* Header */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-brand">
                  <Bot size={20} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">AI Agent Tuning & Engine Configuration</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Fine-tune LLM models, token thresholds, Roman Urdu fluency, and system prompt personality.
                  </p>
                </div>
              </div>

              <button
                onClick={() => void saveProfile()}
                disabled={savingProfile}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
              >
                {savingProfile ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save AI Settings
              </button>
            </div>

            {/* Providers Status */}
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { name: "Groq Cloud", role: "Primary NLU & Fast Voice", model: "qwen-2.5-32b / whisper", status: "Active", speed: "< 450ms" },
                { name: "OpenAI", role: "Embeddings & Semantic Search", model: "text-embedding-3-small", status: "Connected", speed: "~ 600ms" },
                { name: "DeepSeek / Router", role: "Complex Reasoning Fallback", model: "deepseek-chat", status: "Ready", speed: "~ 900ms" },
                { name: "Supabase pgvector", role: "Menu Semantic Matcher", model: "Cosine Similarity (1536d)", status: "Active", speed: "< 80ms" },
              ].map((prov) => (
                <div key={prov.name} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 text-xs">{prov.name}</span>
                    <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      {prov.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">{prov.role}</p>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 border-t border-slate-200/60 pt-1.5">
                    <span className="truncate max-w-[110px] font-mono">{prov.model}</span>
                    <span className="font-semibold text-slate-600">{prov.speed}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Parameters Tuning */}
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="NLU Max Tokens">
                <input
                  type="number"
                  defaultValue={1200}
                  className={inputCls}
                  placeholder="1200"
                />
              </Field>
              <Field label="Answer Max Tokens">
                <input
                  type="number"
                  defaultValue={800}
                  className={inputCls}
                  placeholder="800"
                />
              </Field>
              <Field label="Request Timeout (ms)">
                <input
                  type="number"
                  defaultValue={12000}
                  className={inputCls}
                  placeholder="12000"
                />
              </Field>
              <Field label="Vector Similarity Threshold">
                <input
                  type="number"
                  step="0.05"
                  defaultValue={0.35}
                  className={inputCls}
                  placeholder="0.35"
                />
              </Field>
            </div>

            {/* Personality & Tone Selector */}
            <div className="mt-6 border-t border-slate-200 pt-6">
              <h3 className="text-sm font-bold text-slate-900 mb-3">AI Agent Tone & Hospitality Profile</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  {
                    id: "warm",
                    title: "Warm & Hospitable (Default)",
                    desc: "Polite Pakistani hospitality style. Uses 'Salam', 'Jee zaroor', and ensures polite confirmation before finalizing orders.",
                  },
                  {
                    id: "fast",
                    title: "Fast & Concise",
                    desc: "Optimized for high-speed delivery. Direct answers, minimal fluff, quick button responses.",
                  },
                  {
                    id: "bilingual",
                    title: "Bilingual Roman Urdu + English",
                    desc: "Seamlessly adapts language based on customer input. Understands street food slang, Urdu numbers, and English menu terms.",
                  },
                ].map((preset, i) => (
                  <div
                    key={preset.id}
                    className={clsx(
                      "cursor-pointer rounded-xl border p-4 transition-all",
                      i === 0
                        ? "border-brand/40 bg-brand/5 ring-1 ring-brand/20"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-slate-900 text-xs">{preset.title}</p>
                      {i === 0 && <Check size={14} className="text-brand" />}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{preset.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Interactive NLU Simulator */}
            <div className="mt-8 rounded-xl border border-slate-200 bg-slate-900 p-4 sm:p-5 text-white">
              <div className="flex items-center gap-2 mb-2">
                <Terminal size={16} className="text-orange-400" />
                <h3 className="text-sm font-bold text-white">Interactive NLU & Order Intent Simulator</h3>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Test how the AI categorizes raw customer phrases, extracts quantities, and resolves addresses in real-time.
              </p>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={sandboxPrompt}
                  onChange={(e) => setSandboxPrompt(e.target.value)}
                  placeholder="e.g. bhai 2 chicken biryani aur 1 sprite bhej do gulberg me"
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 outline-none focus:border-orange-400"
                />
                <button
                  onClick={() => {
                    setSimulatingAi(true);
                    setTimeout(() => {
                      const lower = sandboxPrompt.toLowerCase();
                      const hasAddress = lower.includes("gulberg") || lower.includes("defence") || lower.includes("dha") || lower.includes("street");
                      const items: string[] = [];
                      if (lower.includes("biryani")) items.push("2x Chicken Biryani");
                      if (lower.includes("sprite") || lower.includes("coke") || lower.includes("drink")) items.push("1x Sprite Can");
                      if (lower.includes("karahi")) items.push("1x Mutton Karahi (Half)");

                      setSandboxResult({
                        intent: lower.includes("bhej") || lower.includes("order") || lower.includes("chahiye") ? "order_intent" : "menu_inquiry",
                        confidence: 0.96,
                        extractedItems: items.length > 0 ? items : ["1x Selected Menu Item"],
                        addressDetected: hasAddress ? "Gulberg, Lahore" : "Not specified (Address required)",
                        stage: hasAddress ? "confirming" : "collecting_address",
                      });
                      setSimulatingAi(false);
                      toast.success("Intent classified successfully");
                    }, 400);
                  }}
                  disabled={simulatingAi || !sandboxPrompt.trim()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-orange-600 disabled:opacity-50"
                >
                  {simulatingAi ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  <span>Test Parsing</span>
                </button>
              </div>

              {/* Simulator Output Box */}
              {sandboxResult && (
                <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3.5 space-y-2 text-xs font-mono">
                  <div className="flex items-center justify-between text-emerald-400">
                    <span>CLASSIFIED INTENT:</span>
                    <span className="font-bold">{sandboxResult.intent} ({Math.round(sandboxResult.confidence * 100)}% confidence)</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>EXTRACTED CART ITEMS:</span>
                    <span className="text-orange-300 font-bold">{sandboxResult.extractedItems.join(", ")}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>DETECTED ADDRESS:</span>
                    <span>{sandboxResult.addressDetected}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>NEXT FSM STAGE:</span>
                    <span className="text-emerald-300 uppercase">{sandboxResult.stage}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ────────── DIAGNOSTICS & LOGS TAB ────────── */}
      {tab === "diagnostics" && (
        <section className="space-y-6">
          {/* Header & Metrics */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-brand">
                  <Activity size={20} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">AI Turn Observability & Integration Health</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Live telemetry from the <code className="font-mono text-brand">agent_turns</code> and <code className="font-mono text-brand">webhook_events</code> database tables.
                  </p>
                </div>
              </div>

              <button
                onClick={() => void loadDiagnostics()}
                disabled={loadingDiagnostics}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw size={13} className={clsx(loadingDiagnostics && "animate-spin text-brand")} />
                Refresh Telemetry
              </button>
            </div>

            {/* Top KPI Cards */}
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: "Recent Turns", value: diagnosticsData?.metrics.total_recent_turns ?? 0, sub: "in buffer" },
                { label: "Avg Latency", value: `${diagnosticsData?.metrics.avg_latency_ms ?? 0}ms`, sub: "response time" },
                { label: "Success Rate", value: `${diagnosticsData?.metrics.success_rate ?? 100}%`, sub: "clean NLU" },
                { label: "Fallbacks", value: diagnosticsData?.metrics.fallback_count ?? 0, sub: "heuristic assists" },
                { label: "Escalated", value: diagnosticsData?.metrics.escalated_count ?? 0, sub: "to human staff" },
                { label: "Rate Limits", value: diagnosticsData?.metrics.active_rate_limits ?? 0, sub: "active throttles" },
              ].map((kpi) => (
                <div key={kpi.label} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{kpi.label}</p>
                  <p className="mt-1 text-lg font-bold text-slate-900 sm:text-2xl">{kpi.value}</p>
                  <p className="text-[10px] text-slate-500">{kpi.sub}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Live Agent Turns Table */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 p-4 sm:px-6 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Recent AI Turn Log</h3>
                <p className="text-xs text-slate-400">Chronological list of customer inputs, classified intents, and latencies</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600">
                {diagnosticsData?.turns.length ?? 0} logged turns
              </span>
            </div>

            {loadingDiagnostics && !diagnosticsData ? (
              <div className="flex justify-center py-16">
                <Loader2 size={24} className="animate-spin text-brand" />
              </div>
            ) : !diagnosticsData?.turns.length ? (
              <div className="py-16 text-center text-slate-400 text-xs">
                No recent agent turns recorded in database.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 font-bold uppercase tracking-wider text-slate-500 text-[10px]">
                    <tr>
                      <th className="py-3 px-4">Time</th>
                      <th className="py-3 px-4">User Message</th>
                      <th className="py-3 px-4">Intent</th>
                      <th className="py-3 px-4">Stage Transition</th>
                      <th className="py-3 px-4">Latency</th>
                      <th className="py-3 px-4">Vector Search</th>
                      <th className="py-3 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {diagnosticsData.turns.map((turn) => {
                      const isExpanded = expandedTurnId === turn.id;
                      return (
                        <tr
                          key={turn.id}
                          onClick={() => setExpandedTurnId(isExpanded ? null : turn.id)}
                          className="cursor-pointer hover:bg-slate-50/80 transition"
                        >
                          <td className="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                            {new Date(turn.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-900 max-w-[200px] truncate">
                            {turn.user_message || "—"}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-700">
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-mono">
                              {turn.detected_intent || "unknown"}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-500 text-[11px]">
                            {turn.stage_before} &rarr; <span className="font-bold text-slate-800">{turn.stage_after}</span>
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-600">
                            {turn.latency_ms}ms
                          </td>
                          <td className="py-3 px-4">
                            {turn.used_semantic_search ? (
                              <span className="rounded bg-emerald-50 text-emerald-700 font-bold px-1.5 py-0.5 text-[9px] border border-emerald-200">
                                pgvector
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[10px]">Direct</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={clsx(
                                "rounded-full px-2 py-0.5 text-[10px] font-bold capitalize",
                                turn.result_status === "success"
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : turn.result_status === "fallback"
                                    ? "bg-amber-50 text-amber-700 border border-amber-200"
                                    : "bg-red-50 text-red-700 border border-red-200"
                              )}
                            >
                              {turn.result_status?.replace(/_/g, " ") || "success"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Webhook Events Summary */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 mb-1">WhatsApp Webhook Events Monitor</h3>
            <p className="text-xs text-slate-400 mb-4">Realtime ingestion logs from Meta Cloud API</p>

            <div className="grid gap-3 sm:grid-cols-4 mb-4">
              {Object.entries(diagnosticsData?.metrics.webhook_status_counts ?? { processed: 0, received: 0 }).map(([status, count]) => (
                <div key={status} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 capitalize">{status}</span>
                  <p className="text-xl font-bold text-slate-900 mt-0.5">{count}</p>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              {diagnosticsData?.webhooks.slice(0, 10).map((wh) => (
                <div key={wh.id} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-slate-400 text-[10px]">
                      {new Date(wh.created_at).toLocaleTimeString()}
                    </span>
                    <span className="font-semibold text-slate-800">{wh.event_type}</span>
                    <span className="rounded bg-slate-200/60 px-1.5 py-0.2 text-[9px] uppercase font-bold text-slate-600">
                      {wh.provider}
                    </span>
                  </div>
                  <span className={clsx("rounded px-2 py-0.5 text-[10px] font-bold capitalize", wh.status === "processed" ? "bg-emerald-50 text-emerald-700" : "bg-slate-200 text-slate-700")}>
                    {wh.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ────────── SAFETY TAB ────────── */}
      {tab === "safety" && (
        <section className="space-y-4">
          <div className="rounded-xl border border-red-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Danger Zone</h2>
                <p className="mt-1 text-sm text-slate-500">
                  These actions permanently delete operational data and cannot be reversed. Make sure you have a backup before proceeding.
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
                  <div>
                    <p className="text-sm font-semibold text-red-900">Wipe All Operational Data</p>
                    <p className="text-xs text-red-600 mt-1">Clears all conversations, orders, and messages across every branch. Staff accounts and menu configuration are preserved.</p>
                  </div>
                  <button
                    onClick={async () => {
                      const confirmation = window.prompt(
                        `This permanently wipes all operational data across every branch. Type "${WIPE_ALL_CONFIRMATION}" to continue.`,
                      );
                      if (confirmation?.trim() !== WIPE_ALL_CONFIRMATION) return;
                      setResetting(true);
                      try {
                        await readJson(
                          await fetch("/api/admin/reset", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ branch_id: null, confirmation }),
                          }),
                        );
                        toast.success("All operational data cleared.");
                        reloadData();
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Failed to clear data.");
                      } finally {
                        setResetting(false);
                      }
                    }}
                    disabled={resetting}
                    className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition-all hover:border-red-600 hover:bg-red-600 hover:text-white disabled:opacity-50 sm:w-auto"
                  >
                    {resetting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    Wipe All Data
                  </button>
                </div>
              </div>

              {/* Wipe Selected Branch */}
              {selectedBranchId !== "all" && (
                <div className="rounded-xl border border-orange-100 bg-orange-50 p-4">
                  <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
                    <div>
                      <p className="text-sm font-semibold text-orange-900">Wipe Branch: {selectedBranch?.name || "Selected Branch"}</p>
                      <p className="text-xs text-orange-600 mt-1">Clears all operational data for this branch only. Other branches are unaffected.</p>
                    </div>
                    <button
                      onClick={async () => {
                        const branchId = selectedBranchId;
                        const expectedConfirmation = branchWipeConfirmation(branchId);
                        const confirmation = window.prompt(
                          `This permanently wipes operational data for "${selectedBranch?.name || "this branch"}". Type "${expectedConfirmation}" to continue.`,
                        );
                        if (confirmation?.trim() !== expectedConfirmation) return;
                        setResetting(true);
                        try {
                          await readJson(
                            await fetch("/api/admin/reset", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ branch_id: branchId, confirmation }),
                            }),
                          );
                          toast.success("Branch data cleared.");
                          reloadData();
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : "Failed to clear data.");
                        } finally {
                          setResetting(false);
                        }
                      }}
                      disabled={resetting}
                      className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-orange-600 disabled:opacity-50 sm:w-auto"
                    >
                      {resetting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      Wipe Branch
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ────────── ONBOARD NEW RESTAURANT MODAL (SUPER ADMIN) ────────── */}
      {showNewRestaurantModal && session.role === "super_admin" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-xs">
          <div className="relative my-8 w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100 text-purple-700">
                  <Building2 size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Onboard New Restaurant Client</h3>
                  <p className="text-xs text-slate-400">Configure branding, initial branch, and create handover credentials.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowNewRestaurantModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleCreateNewRestaurant} className="max-h-[80vh] overflow-y-auto p-6 space-y-6">
              {/* Section 1: Restaurant Identity */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-purple-800 mb-3 flex items-center gap-1.5">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-purple-100 text-[10px]">1</span>
                  Restaurant Identity &amp; Branding
                </h4>
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Field label="Restaurant Name *">
                      <input
                        required
                        value={newRestaurant.name}
                        onChange={(e) => setNewRestaurant({ ...newRestaurant, name: e.target.value })}
                        className={inputCls}
                        placeholder="e.g. Tandoori Nights or Cheezo Bites"
                      />
                    </Field>
                  </div>

                  <div>
                    <Field label="City">
                      <select
                        value={newRestaurant.city}
                        onChange={(e) => setNewRestaurant({ ...newRestaurant, city: e.target.value })}
                        className={selectCls}
                      >
                        <option value="Islamabad">Islamabad</option>
                        <option value="Rawalpindi">Rawalpindi</option>
                        <option value="Lahore">Lahore</option>
                        <option value="Karachi">Karachi</option>
                        <option value="Peshawar">Peshawar</option>
                      </select>
                    </Field>
                  </div>

                  <div>
                    <Field label="Brand Theme Color">
                      <div className="flex gap-2">
                        <input
                          type="color"
                          value={colorInputValue(newRestaurant.brandColor)}
                          onChange={(e) => setNewRestaurant({ ...newRestaurant, brandColor: e.target.value.toUpperCase() })}
                          className="h-10 w-12 rounded-lg border border-slate-200 bg-white p-1"
                        />
                        <input
                          value={newRestaurant.brandColor}
                          onChange={(e) => setNewRestaurant({ ...newRestaurant, brandColor: e.target.value })}
                          className={inputCls}
                          placeholder="#EA580C"
                        />
                      </div>
                    </Field>
                  </div>

                  <div className="sm:col-span-2">
                    <Field label="Logo Image URL (Optional)">
                      <div className="flex gap-2">
                        <input
                          value={newRestaurant.logoUrl}
                          onChange={(e) => setNewRestaurant({ ...newRestaurant, logoUrl: e.target.value })}
                          className={inputCls}
                          placeholder="https://example.com/logo.png"
                        />
                        {newRestaurant.logoUrl && (
                          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                            <img
                              src={newRestaurant.logoUrl}
                              alt="Preview"
                              className="h-full w-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = "none";
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </Field>
                  </div>

                  <div className="sm:col-span-2">
                    <Field label="Support / WhatsApp Phone Number">
                      <input
                        value={newRestaurant.supportPhone}
                        onChange={(e) => setNewRestaurant({ ...newRestaurant, supportPhone: e.target.value })}
                        className={inputCls}
                        placeholder="e.g. +923001234567"
                      />
                    </Field>
                  </div>
                </div>
              </div>

              {/* Section 2: Menu & AI Setup */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-purple-800 mb-3 flex items-center gap-1.5">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-purple-100 text-[10px]">2</span>
                  WhatsApp Menu &amp; AI Tone
                </h4>
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div>
                    <Field label="Menu Display Mode">
                      <select
                        value={newRestaurant.menuDisplayMode}
                        onChange={(e) =>
                          setNewRestaurant({
                            ...newRestaurant,
                            menuDisplayMode: e.target.value as "interactive_list" | "menu_pictures" | "text_only",
                          })
                        }
                        className={selectCls}
                      >
                        <option value="interactive_list">Interactive Buttons &amp; Lists</option>
                        <option value="menu_pictures">Menu Pictures &amp; Flyers</option>
                        <option value="text_only">Plain Text Formatted</option>
                      </select>
                    </Field>
                  </div>

                  <div>
                    <Field label="AI Voice Tone">
                      <select
                        value={newRestaurant.aiPersonality}
                        onChange={(e) => setNewRestaurant({ ...newRestaurant, aiPersonality: e.target.value })}
                        className={selectCls}
                      >
                        <option value="Warm & Professional">Warm &amp; Professional</option>
                        <option value="Fast & Direct">Fast &amp; Direct</option>
                        <option value="Friendly & Casual">Friendly &amp; Casual</option>
                        <option value="Premium & Polished">Premium &amp; Polished</option>
                      </select>
                    </Field>
                  </div>
                </div>
              </div>

              {/* Section 3: Primary Branch */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-purple-800 mb-3 flex items-center gap-1.5">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-purple-100 text-[10px]">3</span>
                  Primary Branch Outlet
                </h4>
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div>
                    <Field label="Primary Branch Name">
                      <input
                        value={newRestaurant.primaryBranchName}
                        onChange={(e) => setNewRestaurant({ ...newRestaurant, primaryBranchName: e.target.value })}
                        className={inputCls}
                        placeholder="e.g. Main Branch or F-7 Markaz"
                      />
                    </Field>
                  </div>
                  <div>
                    <Field label="Branch Physical Address">
                      <input
                        value={newRestaurant.primaryBranchAddress}
                        onChange={(e) => setNewRestaurant({ ...newRestaurant, primaryBranchAddress: e.target.value })}
                        className={inputCls}
                        placeholder="e.g. Shop 4, Jinnah Super Market"
                      />
                    </Field>
                  </div>
                </div>
              </div>

              {/* Section 4: Client Admin Credentials */}
              <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-purple-900 mb-3 flex items-center gap-1.5">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-purple-200 text-purple-900 text-[10px]">4</span>
                  Client Admin Login Credentials (To Handover)
                </h4>
                <p className="text-[11px] text-purple-700 mb-3">
                  These credentials will allow the restaurant owner or manager to log into their dashboard. They will only see their own restaurant.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Field label="Admin Full Name">
                      <input
                        value={newRestaurant.adminFullName}
                        onChange={(e) => setNewRestaurant({ ...newRestaurant, adminFullName: e.target.value })}
                        className={inputCls}
                        placeholder="e.g. Rashid Khan"
                      />
                    </Field>
                  </div>
                  <div>
                    <Field label="Admin Email *">
                      <input
                        required
                        type="email"
                        value={newRestaurant.adminEmail}
                        onChange={(e) => setNewRestaurant({ ...newRestaurant, adminEmail: e.target.value })}
                        className={inputCls}
                        placeholder="owner@restaurant.com"
                      />
                    </Field>
                  </div>
                  <div>
                    <Field label="Admin Password *">
                      <input
                        required
                        type="password"
                        minLength={8}
                        value={newRestaurant.adminPassword}
                        onChange={(e) => setNewRestaurant({ ...newRestaurant, adminPassword: e.target.value })}
                        className={inputCls}
                        placeholder="Min. 8 characters"
                      />
                    </Field>
                  </div>
                </div>
              </div>

              {/* Footer Actions */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewRestaurantModal(false)}
                  disabled={creatingRestaurant}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingRestaurant}
                  className="inline-flex items-center gap-2 rounded-xl bg-purple-700 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-purple-800 transition disabled:opacity-50"
                >
                  {creatingRestaurant ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Provisioning Client...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={14} />
                      Create Restaurant &amp; Provision Admin
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
