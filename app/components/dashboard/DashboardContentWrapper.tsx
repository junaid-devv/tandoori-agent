"use client";

import { usePathname } from "next/navigation";
import { clsx } from "clsx";

export function DashboardContentWrapper({ children }: { children: React.ReactNode }) {
  const isInbox = usePathname() === "/dashboard/conversations";
  return <div id="main-content" tabIndex={-1} className={clsx("dashboard-content relative min-h-0 flex-1 outline-none", isInbox ? "flex flex-col overflow-hidden p-0 lg:p-5 xl:p-7" : "overflow-y-auto p-5 sm:p-7 xl:px-10 xl:py-8")}>
    <div className={clsx("mx-auto w-full max-w-[1440px]", isInbox && "flex h-full min-h-0 flex-1 flex-col")}>{children}</div>
  </div>;
}
