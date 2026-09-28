import { redirect } from "next/navigation";
import { getDashboardSession } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getDashboardSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-slate-50">
      <LoginForm profile={{ app_name: process.env.NEXT_PUBLIC_APP_NAME || "ORDERiQ", brand_color: "#EA580C" } as any} />
    </main>
  );
}
