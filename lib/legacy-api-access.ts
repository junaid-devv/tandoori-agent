import { NextResponse } from "next/server";
import { getDashboardSession } from "./auth";
import { requireSuperAdminSession } from "./admin-request";

export async function requireDemoAdmin() {
  if (process.env.NODE_ENV !== "production") return null;
  if (process.env.ENABLE_DEMO_MODE !== "true") return NextResponse.json({ error: "Demo mode disabled" }, { status: 403 });
  const session = await getDashboardSession();
  return session?.role === "super_admin" ? null : NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function requireUniversityAdmin() {
  if (process.env.APP_MODE !== "university") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return (await requireSuperAdminSession()).response;
}
