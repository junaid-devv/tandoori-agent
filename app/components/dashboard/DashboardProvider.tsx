"use client";

import { createContext, useContext, useMemo, useState, useCallback, useSyncExternalStore, startTransition } from "react";
import { useRouter } from "next/navigation";
import type { DashboardSession } from "@/lib/auth";
import type { RestaurantProfile } from "@/lib/restaurant-profile-types";

type SelectedBranchId = string | "all";

type DashboardContextValue = {
  session: DashboardSession;
  profile: RestaurantProfile;
  setProfile: (profile: RestaurantProfile) => void;
  selectedBranchId: SelectedBranchId;
  selectedBranch:
    | {
        id: string;
        slug: string;
        name: string;
        address: string;
      }
    | null;
  setSelectedBranchId: (branchId: SelectedBranchId) => void;
  isSidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
  isSoundEnabled: boolean;
  toggleSoundEnabled: () => void;
  isAutoPrintEnabled: boolean;
  toggleAutoPrintEnabled: () => void;
  receiptPaperWidth: "58mm" | "80mm";
  setReceiptPaperWidth: (width: "58mm" | "80mm") => void;
  isContextPanelOpen: boolean;
  toggleContextPanelOpen: () => void;
  logout: () => Promise<void>;
};

const STORAGE_KEY = "restaurant-agent-selected-branch";
const SIDEBAR_COLLAPSED_KEY = "dashboard-sidebar-collapsed";
const SOUND_ENABLED_KEY = "dashboard-sound-enabled";
const AUTO_PRINT_ENABLED_KEY = "dashboard-autoprint-enabled";
const RECEIPT_WIDTH_KEY = "dashboard-receipt-paper-width";
const CONTEXT_PANEL_KEY = "dashboard-context-panel-open";
const DashboardContext = createContext<DashboardContextValue | null>(null);

function getInitialBranchId(session: DashboardSession, profile: RestaurantProfile): SelectedBranchId {
  // If there's only 1 branch, always select it directly!
  if (session.allowedBranches.length === 1) {
    return session.allowedBranches[0].id;
  }

  const adminCanViewAll = (session.role === "admin" || session.role === "super_admin") && profile.branch_mode === "multiple";
  const profileDefaultBranchId =
    profile.default_branch_id && session.allowedBranches.some((branch) => branch.id === profile.default_branch_id)
      ? profile.default_branch_id
      : null;

  if (adminCanViewAll) {
    return "all";
  }

  if (profile.branch_mode !== "multiple") {
    return profileDefaultBranchId ?? session.defaultBranchId ?? session.allowedBranches[0]?.id ?? "all";
  }

  return session.defaultBranchId ?? session.allowedBranches[0]?.id ?? "all";
}

function resolveStoredBranchId(
  session: DashboardSession,
  profile: RestaurantProfile,
  rawValue: string | null,
): SelectedBranchId | null {
  if (!rawValue) return null;
  const adminCanViewAll = (session.role === "admin" || session.role === "super_admin") && profile.branch_mode === "multiple";

  if (!adminCanViewAll && rawValue === "all") {
    return null;
  }

  if (rawValue === "all") {
    if (session.allowedBranches.length === 1) {
      return session.allowedBranches[0].id;
    }
    return adminCanViewAll ? "all" : null;
  }

  const isAllowed = session.allowedBranches.some((branch) => branch.id === rawValue);
  return isAllowed ? rawValue : null;
}

// Read persisted preferences after hydration, so saved layouts never disagree with SSR.
const preferenceEvent = "dashboard-preference-change";
function subscribePreferences(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(preferenceEvent, notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener(preferenceEvent, notify); };
}
const getServerPreference = () => null;
function usePreference(key: string) {
  const read = useCallback(() => { try { return window.localStorage.getItem(key); } catch { return null; } }, [key]);
  const value = useSyncExternalStore(subscribePreferences, read, getServerPreference);
  const set = useCallback((next: string) => {
    try { window.localStorage.setItem(key, next); } catch { return; }
    window.dispatchEvent(new Event(preferenceEvent));
  }, [key]);
  return [value, set] as const;
}

export function DashboardProvider({
  session,
  profile,
  children,
}: {
  session: DashboardSession;
  profile: RestaurantProfile;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [profileState, setProfileState] = useState(profile);
  const [storedBranch, storeBranch] = usePreference(STORAGE_KEY);
  const selectedBranchId = resolveStoredBranchId(session, profileState, storedBranch) ?? getInitialBranchId(session, profileState);
  const [sidebar, storeSidebar] = usePreference(SIDEBAR_COLLAPSED_KEY);
  const [sound, storeSound] = usePreference(SOUND_ENABLED_KEY);
  const [autoPrint, storeAutoPrint] = usePreference(AUTO_PRINT_ENABLED_KEY);
  const [paperWidth, storePaperWidth] = usePreference(RECEIPT_WIDTH_KEY);
  const [contextPanel, storeContextPanel] = usePreference(CONTEXT_PANEL_KEY);
  const isSidebarCollapsed = sidebar === "true";
  const isSoundEnabled = sound !== "false";
  const isAutoPrintEnabled = autoPrint === "true";
  const receiptPaperWidth = paperWidth === "58mm" ? "58mm" : "80mm";
  const isContextPanelOpen = contextPanel === "true";

  const selectedBranch = useMemo(() => {
    if (selectedBranchId === "all") return null;
    return session.allowedBranches.find((branch) => branch.id === selectedBranchId) ?? null;
  }, [selectedBranchId, session.allowedBranches]);

  const value = useMemo<DashboardContextValue>(() => {
    return {
      session,
      profile: profileState,
      setProfile: setProfileState,
      selectedBranchId,
      selectedBranch,
      setSelectedBranchId: storeBranch,
      isSidebarCollapsed,
      toggleSidebarCollapsed: () => storeSidebar(String(!isSidebarCollapsed)),
      isSoundEnabled,
      toggleSoundEnabled: () => storeSound(String(!isSoundEnabled)),
      isAutoPrintEnabled,
      toggleAutoPrintEnabled: () => storeAutoPrint(String(!isAutoPrintEnabled)),
      receiptPaperWidth,
      setReceiptPaperWidth: storePaperWidth,
      isContextPanelOpen,
      toggleContextPanelOpen: () => storeContextPanel(String(!isContextPanelOpen)),
      logout: async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        startTransition(() => {
          router.replace("/login");
          router.refresh();
        });
      },
    };
  }, [
    isAutoPrintEnabled,
    isContextPanelOpen,
    isSidebarCollapsed,
    isSoundEnabled,
    profileState,
    receiptPaperWidth,
    router,
    selectedBranch,
    selectedBranchId,
    session,
    storeBranch, storeSidebar, storeSound, storeAutoPrint, storePaperWidth, storeContextPanel,
  ]);

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboardContext() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error("useDashboardContext must be used within DashboardProvider.");
  }

  return context;
}
