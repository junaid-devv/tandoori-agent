import { redirect } from "next/navigation";
import { getDashboardSession } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getDashboardSession();
  if (session) redirect("/dashboard");
  return <main className="login-screen"><LoginForm /></main>;
}
