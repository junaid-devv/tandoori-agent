import { supabaseAdmin } from "../supabase-admin";

export interface StudentLeadRecord {
  id: string;
  phone: string;
  full_name: string | null;
  program_interest: string | null;
  degree_level: string | null;
  prior_qualification: string | null;
  percentage_marks: number | null;
  eligibility_confirmed: boolean;
  lead_status: "new" | "contacted" | "visit_planned" | "visited_dec" | "enrolled" | "lost";
  source: string;
  campaign_id: string | null;
  counselor_notes: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

export interface LeadUpsertInput {
  phone: string;
  fullName?: string | null;
  programInterest?: string | null;
  degreeLevel?: string | null;
  priorQualification?: string | null;
  percentageMarks?: number | null;
  leadStatus?: "new" | "contacted" | "visit_planned" | "visited_dec" | "enrolled" | "lost";
  source?: string;
  notes?: string | null;
}

export async function upsertStudentLead(input: LeadUpsertInput): Promise<string | null> {
  const cleanPhone = input.phone.replace(/[^0-9+]/g, "").replace(/^\+/, "");
  
  // Try RPC first if available, otherwise direct query
  try {
    const { data, error } = await supabaseAdmin.rpc("upsert_student_lead", {
      p_phone: cleanPhone,
      p_full_name: input.fullName ?? null,
      p_program_interest: input.programInterest ?? null,
      p_degree_level: input.degreeLevel ?? null,
      p_prior_qualification: input.priorQualification ?? null,
      p_percentage_marks: input.percentageMarks ?? null,
      p_lead_status: input.leadStatus ?? null,
      p_source: input.source ?? "meta_ad",
      p_notes: input.notes ?? null,
    });

    if (!error && data) {
      return data as string;
    }
  } catch {
    // Fall back to direct table upsert
  }

  const payload: Record<string, unknown> = {
    phone: cleanPhone,
    updated_at: new Date().toISOString(),
    last_message_at: new Date().toISOString(),
  };

  if (input.fullName) payload.full_name = input.fullName;
  if (input.programInterest) payload.program_interest = input.programInterest;
  if (input.degreeLevel) payload.degree_level = input.degreeLevel;
  if (input.priorQualification) payload.prior_qualification = input.priorQualification;
  if (input.percentageMarks !== undefined && input.percentageMarks !== null) {
    payload.percentage_marks = input.percentageMarks;
    payload.eligibility_confirmed = input.percentageMarks >= 45;
  }
  if (input.leadStatus) payload.lead_status = input.leadStatus;
  if (input.source) payload.source = input.source;
  if (input.notes) payload.counselor_notes = input.notes;

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("student_leads")
    .upsert(payload, { onConflict: "phone" })
    .select("id")
    .single();

  if (insertErr) {
    console.error("[lead-manager] Error upserting student lead:", insertErr);
    return null;
  }

  return inserted?.id ?? null;
}

export async function getLeadByPhone(phone: string): Promise<StudentLeadRecord | null> {
  const cleanPhone = phone.replace(/[^0-9+]/g, "").replace(/^\+/, "");
  const { data, error } = await supabaseAdmin
    .from("student_leads")
    .select("*")
    .eq("phone", cleanPhone)
    .maybeSingle();

  if (error) {
    console.error("[lead-manager] Error fetching lead by phone:", error);
    return null;
  }

  return data as StudentLeadRecord | null;
}

export async function listStudentLeads(options: {
  program?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ leads: StudentLeadRecord[]; count: number }> {
  let query = supabaseAdmin
    .from("student_leads")
    .select("*", { count: "exact" })
    .order("last_message_at", { ascending: false });

  if (options.program && options.program !== "all") {
    query = query.ilike("program_interest", `%${options.program}%`);
  }

  if (options.status && options.status !== "all") {
    query = query.eq("lead_status", options.status);
  }

  if (options.search) {
    const s = `%${options.search}%`;
    query = query.or(`full_name.ilike.${s},phone.ilike.${s},prior_qualification.ilike.${s}`);
  }

  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  query = query.range(offset, offset + limit - 1);

  const { data, count, error } = await query;

  if (error) {
    console.error("[lead-manager] Error listing student leads:", error);
    return { leads: [], count: 0 };
  }

  return {
    leads: (data ?? []) as StudentLeadRecord[],
    count: count ?? (data?.length ?? 0),
  };
}

export async function updateLeadStatus(
  leadId: string,
  leadStatus: string,
  notes?: string
): Promise<boolean> {
  const updatePayload: Record<string, unknown> = {
    lead_status: leadStatus,
    updated_at: new Date().toISOString(),
  };

  if (notes) {
    updatePayload.counselor_notes = notes;
  }

  const { error } = await supabaseAdmin
    .from("student_leads")
    .update(updatePayload)
    .eq("id", leadId);

  if (error) {
    console.error("[lead-manager] Error updating lead status:", error);
    return false;
  }

  return true;
}

export async function getAdmissionsDashboardStats(): Promise<{
  totalLeads: number;
  newLeadsToday: number;
  visitedCount: number;
  enrolledCount: number;
  programBreakdown: Record<string, number>;
  qualificationBreakdown: Record<string, number>;
}> {
  const { data: leads, error } = await supabaseAdmin
    .from("student_leads")
    .select("program_interest, prior_qualification, lead_status, created_at");

  if (error || !leads) {
    return {
      totalLeads: 0,
      newLeadsToday: 0,
      visitedCount: 0,
      enrolledCount: 0,
      programBreakdown: {},
      qualificationBreakdown: {},
    };
  }

  const todayStr = new Date().toISOString().split("T")[0];
  let newToday = 0;
  let visited = 0;
  let enrolled = 0;
  const programCounts: Record<string, number> = {};
  const qualCounts: Record<string, number> = {};

  for (const lead of leads) {
    if (lead.created_at && lead.created_at.startsWith(todayStr)) {
      newToday += 1;
    }
    if (lead.lead_status === "visited_dec") visited += 1;
    if (lead.lead_status === "enrolled") enrolled += 1;

    const prog = lead.program_interest || "Unspecified";
    programCounts[prog] = (programCounts[prog] || 0) + 1;

    const qual = lead.prior_qualification || "Unspecified";
    qualCounts[qual] = (qualCounts[qual] || 0) + 1;
  }

  return {
    totalLeads: leads.length,
    newLeadsToday: newToday,
    visitedCount: visited,
    enrolledCount: enrolled,
    programBreakdown: programCounts,
    qualificationBreakdown: qualCounts,
  };
}
