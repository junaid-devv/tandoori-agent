import { LoginForm } from "./LoginForm";
import { getRestaurantProfile } from "@/lib/restaurant-profile";

export default async function LoginPage() {
  const profile = await getRestaurantProfile();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-slate-50">
      <LoginForm profile={profile} />
    </main>
  );
}
