"use client";

import { usePathname } from "next/navigation";
import { clsx } from "clsx";

export function DashboardContentWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isConversations = pathname === "/dashboard/conversations";

  return (
    <div
      className={clsx(
        "no-scrollbar relative z-10 flex-1 min-h-0",
        isConversations
          ? "flex flex-col overflow-hidden p-0 pb-14 lg:pb-0"
          : "overflow-y-auto p-3 pb-28 sm:p-5 sm:pb-8 lg:p-6 xl:p-8"
      )}
    >
      <div className={clsx("w-full", isConversations ? "h-full flex-1 flex flex-col min-h-0" : "max-w-[1600px] mx-auto")}>
        {children}
      </div>
    </div>
  );
}
