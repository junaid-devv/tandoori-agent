"use client";

import { usePathname } from "next/navigation";
import { clsx } from "clsx";

export function DashboardContentWrapper({ children }: { children: React.ReactNode }) {
  const isInbox = usePathname() === "/dashboard/conversations";
  return <div id="main-content" tabIndex={-1} className={clsx("dashboard-content relative min-h-0 flex-1 outline-none", isInbox ? "flex flex-col overflow-hidden p-0 lg:p-5" : "overflow-y-auto p-4 sm:p-6 xl:p-7")}>
    <div className={clsx("page-content mx-auto w-full", isInbox && "flex h-full min-h-0 flex-1 flex-col")}>{children}</div>
  </div>;
}
