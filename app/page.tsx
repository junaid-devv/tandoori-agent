import { redirect } from "next/navigation";
import { getDashboardSession } from "@/lib/auth";

export default async function Home() {
  if (process.env.APP_MODE === "university" || process.env.NEXT_PUBLIC_APP_MODE === "university") {
    redirect("/dashboard");
  }

  const session = await getDashboardSession();
  redirect(session ? "/dashboard" : "/login");
}
