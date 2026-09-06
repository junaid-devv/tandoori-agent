import { NextRequest, NextResponse } from "next/server";
import {
  listStudentLeads,
  upsertStudentLead,
  updateLeadStatus,
  getAdmissionsDashboardStats,
} from "@/lib/university/lead-manager";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const program = searchParams.get("program") || undefined;
    const status = searchParams.get("status") || undefined;
    const search = searchParams.get("search") || undefined;
    const statsOnly = searchParams.get("statsOnly") === "true";

    if (statsOnly) {
      const stats = await getAdmissionsDashboardStats();
      return NextResponse.json(stats);
    }

    const [leadsResult, stats] = await Promise.all([
      listStudentLeads({ program, status, search, limit: 100 }),
      getAdmissionsDashboardStats(),
    ]);

    return NextResponse.json({
      leads: leadsResult.leads,
      count: leadsResult.count,
      stats,
    });
  } catch (error) {
    console.error("[api/university/leads] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch student leads" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // If updating lead status
    if (body.action === "update_status" && body.leadId && body.status) {
      const success = await updateLeadStatus(body.leadId, body.status, body.notes);
      return NextResponse.json({ success });
    }

    // Manual lead creation (e.g. walk-in student at DEC Gilgit)
    if (!body.phone) {
      return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
    }

    const leadId = await upsertStudentLead({
      phone: body.phone,
      fullName: body.fullName,
      programInterest: body.programInterest,
      degreeLevel: body.degreeLevel,
      priorQualification: body.priorQualification,
      percentageMarks: body.percentageMarks ? Number(body.percentageMarks) : undefined,
      leadStatus: body.leadStatus || "new",
      source: body.source || "dec_walkin",
      notes: body.notes,
    });

    return NextResponse.json({ success: true, leadId });
  } catch (error) {
    console.error("[api/university/leads] POST error:", error);
    return NextResponse.json({ error: "Failed to process lead action" }, { status: 500 });
  }
}
