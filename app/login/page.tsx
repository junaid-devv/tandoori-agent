import { redirect } from "next/navigation";
import { getDashboardSession } from "@/lib/auth";
import { getRestaurantProfile } from "@/lib/restaurant-profile";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getDashboardSession();
  if (session) {
    redirect("/dashboard");
  }

  const profile = await getRestaurantProfile();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-slate-50">
      <LoginForm profile={profile} />
    </main>
  );
}
