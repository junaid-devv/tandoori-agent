import { redirect } from "next/navigation";
import { requireDashboardSession } from "@/lib/auth";
import { ClientDirectory } from "@/app/components/dashboard/ClientDirectory";

export default async function ClientsPage() {
  const session = await requireDashboardSession();
  if (session.role !== "super_admin") redirect("/dashboard");
  return <ClientDirectory />;
}
