"use client";

import { createContext, useContext, useMemo, useState, startTransition } from "react";
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
  logout: () => Promise<void>;
};

const STORAGE_KEY = "restaurant-agent-selected-branch";
const DashboardContext = createContext<DashboardContextValue | null>(null);

function getInitialBranchId(session: DashboardSession, profile: RestaurantProfile): SelectedBranchId {
  const adminCanViewAll = session.role === "admin" && profile.branch_mode === "multiple";
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
  const adminCanViewAll = session.role === "admin" && profile.branch_mode === "multiple";

  if (!adminCanViewAll && rawValue === "all") {
    return null;
  }

  if (rawValue === "all") {
    return adminCanViewAll ? "all" : null;
  }

  const isAllowed = session.allowedBranches.some((branch) => branch.id === rawValue);
  return isAllowed ? rawValue : null;
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
  const [selectedBranchId, setSelectedBranchIdState] = useState<SelectedBranchId>(() => {
    const fallbackBranchId = getInitialBranchId(session, profile);
    if (typeof window === "undefined") {
      return fallbackBranchId;
    }

    const stored = window.localStorage.getItem(STORAGE_KEY);
    return resolveStoredBranchId(session, profile, stored) ?? fallbackBranchId;
  });

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
      setSelectedBranchId: (branchId) => {
        setSelectedBranchIdState(branchId);
        window.localStorage.setItem(STORAGE_KEY, branchId);
      },
      logout: async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        startTransition(() => {
          router.replace("/login");
          router.refresh();
        });
      },
    };
  }, [profileState, router, selectedBranch, selectedBranchId, session]);

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboardContext() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error("useDashboardContext must be used within DashboardProvider.");
  }

  return context;
}
