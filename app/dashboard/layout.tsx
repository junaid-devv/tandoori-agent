import { DashboardProvider } from "@/app/components/dashboard/DashboardProvider";
import { NotificationProvider } from "@/app/components/dashboard/NotificationHub";
import { requireDashboardSession } from "@/lib/auth";
import { Sidebar } from "@/app/components/Sidebar";
import { Header } from "@/app/components/Header";
import { DashboardContentWrapper } from "@/app/components/dashboard/DashboardContentWrapper";
import { getRestaurantProfile } from "@/lib/restaurant-profile";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (process.env.APP_MODE === "university" || process.env.NEXT_PUBLIC_APP_MODE === "university") {
    return <>{children}</>;
  }

  const session = await requireDashboardSession();
  const profile = await getRestaurantProfile(session.restaurantId ?? undefined);

  return (
    <DashboardProvider session={session} profile={profile}>
      <NotificationProvider>
        <div className="dashboard-shell relative flex h-dvh overflow-hidden bg-bg-app text-slate-900">
          <a href="#main-content" className="skip-link">Skip to content</a>
          <Sidebar />

          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <Header />

          <DashboardContentWrapper>
            {children}
          </DashboardContentWrapper>
        </main>
      </div>
      </NotificationProvider>
    </DashboardProvider>
  );
}
