"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { PageHeader } from "./PageHeader";
import { ErrorNotice, SectionNav } from "./WorkspaceUI";
import { clsx } from "clsx";
import {
  Loader2,
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
  Activity,
  RefreshCw,
  Check,
  Image as ImageIcon,
  UploadCloud,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { useDashboardContext } from "./DashboardProvider";
import { useDataCache, invalidateCache } from "@/lib/useDataCache";
import type { RestaurantProfile } from "@/lib/restaurant-profile-types";

type Tab = "branding" | "presentation" | "branches" | "staff" | "diagnostics" | "safety";

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
    <label className="block">
      <span className="ui-label">{label}</span>
      {children}
    </label>
  );
}

const inputCls = "ui-input";
const selectCls = inputCls;

function colorInputValue(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#EA580C";
}

export default function AdminConsole() {
  const { session, profile, setProfile, selectedBranchId, selectedBranch, setSelectedBranchId } = useDashboardContext();
  const [tab, setTab] = useState<Tab>("branding");
  useEffect(() => {
    const sync = () => {
      const key = window.location.hash.slice(1);
      if (["branding", "presentation", "branches", "staff", "diagnostics", "safety"].includes(key)) setTab(key as Tab);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [profileDraft, setProfileDraft] = useState<RestaurantProfile>(profile);

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

  // Stale-while-revalidate for admin data
  const { data: cachedBranches, isLoading: branchesLoading, error: branchesError, revalidate: revalidateBranches } =
    useDataCache<BranchSummary[]>("/api/admin/branches");
  const { data: cachedStaff, isLoading: staffLoading, error: staffError, revalidate: revalidateStaff } =
    useDataCache<StaffSummary[]>("/api/admin/staff");
  const { data: cachedProfile, isLoading: profileLoading, error: profileError, revalidate: revalidateProfile } =
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
    toast.success("Image URL added to draft. Click 'Save presentation' to persist.");
  }

  if (session.role !== "admin" && session.role !== "super_admin") return null;

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "branding", label: "Business profile", icon: <Palette size={15} /> },
    { key: "branches", label: "Branches", icon: <GitBranch size={15} /> },
    { key: "staff", label: "Team & access", icon: <Users size={15} /> },
    { key: "presentation", label: "Menu presentation", icon: <ImageIcon size={15} /> },
    { key: "diagnostics", label: "Diagnostics", icon: <Activity size={15} /> },
    { key: "safety", label: "Data controls", icon: <ShieldAlert size={15} /> },
  ];

  return (
    <div className="admin-body space-y-5 pb-2">
      <PageHeader title="Administration" description="Business identity, locations, team access and system tools." actions={<Link href="/dashboard/settings" className="ui-button">Business settings<ChevronRight size={14} /></Link>} />
      {(branchesError || staffError || profileError) && <ErrorNotice message="Some administration data could not be loaded." retry={reloadData} />}
      <SectionNav items={tabs} value={tab} onChange={key => { setTab(key); window.history.replaceState(null, "", `#${key}`); }} label="Administration sections" />
      {/* ────────── BRANDING TAB ────────── */}
      {tab === "branding" && (
        <section className="space-y-6">
          <div className="ui-card p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="ui-section-title">Restaurant Profile</h2>
                <p className="mt-1 text-xs text-slate-400">
                  Controls the dashboard brand, WhatsApp identity, and whether customers see branch selection.
                </p>
              </div>
              <button
                onClick={() => void saveProfile()}
                disabled={savingProfile}
                className="ui-button ui-button-primary"
              >
                {savingProfile ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Profile
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
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
                  <input aria-label="Brand color hex value" value={profileDraft.brand_color} onChange={(event) => updateProfileDraft("brand_color", event.target.value)} className={inputCls} />
                </div>
              </Field>
              <Field label="Hover Color">
                <div className="flex gap-2">
                  <input type="color" value={colorInputValue(profileDraft.brand_hover_color)} onChange={(event) => updateProfileDraft("brand_hover_color", event.target.value.toUpperCase())} className="h-10 w-12 rounded-lg border border-slate-200 bg-white p-1" />
                  <input aria-label="Hover color hex value" value={profileDraft.brand_hover_color} onChange={(event) => updateProfileDraft("brand_hover_color", event.target.value)} className={inputCls} />
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

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="ui-card p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
                  <GitBranch size={16} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Location Mode</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    Customers order directly from your main location. Choose multiple branches to let them pick a location.
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
                        ? "border-orange-200 bg-orange-50 text-orange-900"
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

            <div className="ui-card p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
                  <Users size={16} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Fallback contact details</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    Optional defaults used when a location has no contact details. Manage daily preferences in Settings.
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

              </div>
            </div>
          </div>

        </section>
      )}

      {tab === "presentation" && (
        <section className="space-y-6">
          <div className="flex justify-end"><button onClick={() => void saveProfile()} disabled={savingProfile} className="ui-button ui-button-primary">{savingProfile ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}Save presentation</button></div>
          {/* Menu Display & WhatsApp Engine Configuration */}
          <div className="space-y-6">
            {/* Menu Display Mode */}
            <div className="ui-card p-5 sm:p-6">
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
                    body: "Send uploaded menu cards and deal images.",
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
                    onClick={() => updateProfileDraft("menu_display_mode", option.value as RestaurantProfile["menu_display_mode"])}
                    aria-pressed={(profileDraft.menu_display_mode || "interactive_list") === option.value}
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

          </div>
        </section>
      )}

      {tab === "branches" && (
        <section className="space-y-6">
          {/* Create Branch Card */}
          <details className="ui-card group"><summary className="flex items-center justify-between p-5 text-sm font-medium text-slate-700 sm:px-6">Add a location<Plus size={16} className="text-brand" /></summary>
          <div className="border-t border-slate-100 p-5 sm:p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
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
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-40 md:h-[72px] md:min-w-[140px]"
              >
                {creatingBranch ? <Loader2 size={16} className="animate-spin" /> : <><Plus size={14} /> Create Branch</>}
              </button>
            </div>
          </div>

          </details>

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
                    role="button" tabIndex={0} aria-expanded={isExpanded}
                    className="group flex cursor-pointer items-center gap-3 px-4 py-4 transition-colors hover:bg-slate-50 sm:gap-4 sm:px-6"
                    onClick={() => setExpandedBranch(isExpanded ? null : branch.id)}
                    onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setExpandedBranch(isExpanded ? null : branch.id); } }}
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
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
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
        <section className="space-y-6">
          {/* Create Staff Card */}
          <details className="ui-card"><summary className="flex items-center justify-between p-5 text-sm font-medium text-slate-700 sm:px-6">Add a team member<Plus size={16} className="text-brand" /></summary>
          <div className="border-t border-slate-100 p-5 sm:p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
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
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-40 sm:w-auto"
                >
                  {creatingStaff ? <Loader2 size={14} className="animate-spin" /> : <><Plus size={14} /> Create Account</>}
                </button>
              </div>
            </div>
          </div>
          </details>

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
                    role="button" tabIndex={0} aria-expanded={isExpanded}
                    className="group flex cursor-pointer items-center gap-3 px-4 py-4 transition-colors hover:bg-slate-50 sm:gap-4 sm:px-6"
                    onClick={() => setExpandedStaff(isExpanded ? null : member.user_id)}
                    onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setExpandedStaff(isExpanded ? null : member.user_id); } }}
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
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
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

      {/* ────────── DIAGNOSTICS & LOGS TAB ────────── */}
      {tab === "diagnostics" && (
        <section className="space-y-6">
          {/* Header & Metrics */}
          <div className="ui-card p-5 sm:p-6">
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
          <div className="ui-card p-5 sm:p-6">
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

    </div>
  );
}
