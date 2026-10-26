import { redirect } from "next/navigation";
import { requireDashboardSession } from "@/lib/auth";
import { ClientOnboarding } from "@/app/components/dashboard/ClientOnboarding";

export default async function NewClientPage() {
  const session = await requireDashboardSession();
  if (session.role !== "super_admin") redirect("/dashboard");
  return <ClientOnboarding />;
}
