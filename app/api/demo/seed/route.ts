import { NextResponse } from "next/server";
import { seedDemoData } from "@/demo/seed/seed-demo-data";
import { getDashboardSession } from "@/lib/auth";

export async function POST(request: Request) {
  const isDemoEnabled = process.env.ENABLE_DEMO_MODE === "true" || process.env.NODE_ENV !== "production";
  const demoSecret = request.headers.get("x-demo-secret");
  const expectedSecret = process.env.DEMO_SECRET_KEY || "restaurant-demo-secret-key";
  const session = await getDashboardSession();

  if (!isDemoEnabled && demoSecret !== expectedSecret && !session) {
    return NextResponse.json({ error: "Demo mode disabled or unauthorized" }, { status: 403 });
  }

  try {
    const result = await seedDemoData();
    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("[api/demo/seed] Error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Seed failed" }, { status: 500 });
  }
}
