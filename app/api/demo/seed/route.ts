import { NextResponse } from "next/server";
import { seedDemoData } from "@/demo/seed/seed-demo-data";
import { requireDemoAdmin } from "@/lib/legacy-api-access";

export async function POST() {
  const denied = await requireDemoAdmin();
  if (denied) return denied;

  try {
    const result = await seedDemoData();
    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("[api/demo/seed] Error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Seed failed" }, { status: 500 });
  }
}
