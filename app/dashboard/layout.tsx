import { DashboardProvider } from "@/app/components/dashboard/DashboardProvider";
import { requireDashboardSession } from "@/lib/auth";
import { Sidebar } from "@/app/components/Sidebar";
import { getRestaurantProfile } from "@/lib/restaurant-profile";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [session, profile] = await Promise.all([
    requireDashboardSession(),
    getRestaurantProfile(),
  ]);

  return (
    <DashboardProvider session={session} profile={profile}>
      <div className="flex h-dvh flex-col overflow-hidden bg-slate-50 text-slate-900 lg:flex-row">
        <Sidebar />

        <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none z-0 opacity-[0.03]"
            style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, black 1px, transparent 0)', backgroundSize: '24px 24px' }}
          />

          <div className="no-scrollbar relative z-10 flex-1 overflow-y-auto p-3 pb-24 sm:p-6 sm:pb-8 lg:p-8 xl:p-10">
            <div className="max-w-[1400px] mx-auto w-full">
              {children}
            </div>
          </div>
        </main>
      </div>
    </DashboardProvider>
  );
}
