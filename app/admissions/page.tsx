"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  GraduationCap,
  Users,
  Calendar,
  Clock,
  Search,
  Filter,
  Download,
  Plus,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  Phone,
  Send,
  UserCheck,
  Building,
  BookOpen,
  ArrowUpDown,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  X,
} from "lucide-react";

interface StudentLead {
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
  counselor_notes: string | null;
  last_message_at: string;
  created_at: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  sender_kind: "user" | "ai" | "human" | "system";
  content: string;
  created_at: string;
}

interface StatsData {
  totalLeads: number;
  newLeadsToday: number;
  visitedCount: number;
  enrolledCount: number;
  programBreakdown: Record<string, number>;
  qualificationBreakdown: Record<string, number>;
}

const PROGRAM_OPTIONS = [
  "All",
  "BBA",
  "B.Ed",
  "English",
  "Education",
  "Urdu",
  "Health & Physical Education",
];

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; text: string; border: string }
> = {
  new: { label: "New Inquiry", bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  contacted: { label: "Contacted", bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  visit_planned: { label: "Visit Planned", bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
  visited_dec: { label: "Visited DEC", bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200" },
  enrolled: { label: "Enrolled", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  lost: { label: "Lost / Ineligible", bg: "bg-gray-50", text: "text-gray-600", border: "border-gray-200" },
};

export default function UniversityAdmissionsDashboard() {
  const [leads, setLeads] = useState<StudentLead[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProgram, setSelectedProgram] = useState("All");
  const [selectedStatus, setSelectedStatus] = useState("All");
  const [activeTab, setActiveTab] = useState<"leads" | "programs" | "dec_info">("leads");

  // Selected lead for conversation drawer
  const [activeLead, setActiveLead] = useState<StudentLead | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [counselorReply, setCounselorReply] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [convMode, setConvMode] = useState<"bot" | "human">("bot");

  // Walk-in modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLeadForm, setNewLeadForm] = useState({
    fullName: "",
    phone: "",
    programInterest: "BBA",
    priorQualification: "FA/FSc",
    percentageMarks: "",
    notes: "",
  });

  // Calculate days remaining
  const daysRemaining = useMemo(() => {
    const deadline = new Date("2026-09-10T23:59:59+05:00");
    const now = new Date();
    const diff = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 0;
  }, []);

  // Fetch leads and stats
  const fetchLeadsAndStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/university/leads");
      if (res.ok) {
        const data = await res.json();
        setLeads(data.leads || []);
        setStats(data.stats || null);
      }
    } catch (err) {
      console.error("Failed to load admissions leads:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeadsAndStats();
  }, [fetchLeadsAndStats]);

  // Load chat messages when active lead selected
  const loadLeadChat = useCallback(async (phone: string) => {
    setChatLoading(true);
    try {
      const res = await fetch(`/api/university/messages?phone=${encodeURIComponent(phone)}`);
      if (res.ok) {
        const data = await res.json();
        setChatMessages(data.messages || []);
        setConvMode(data.mode || "bot");
      }
    } catch (err) {
      console.error("Failed to load chat history:", err);
    } finally {
      setChatLoading(false);
    }
  }, []);

  const openLeadDrawer = (lead: StudentLead) => {
    setActiveLead(lead);
    loadLeadChat(lead.phone);
  };

  // Send manual counselor message
  const handleSendCounselorMessage = async () => {
    if (!activeLead || !counselorReply.trim()) return;
    setSendingReply(true);
    try {
      const res = await fetch("/api/university/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: activeLead.phone,
          content: counselorReply.trim(),
        }),
      });

      if (res.ok) {
        setCounselorReply("");
        await loadLeadChat(activeLead.phone);
        await fetchLeadsAndStats();
      }
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setSendingReply(false);
    }
  };

  // Toggle Bot vs Human Takeover
  const handleToggleMode = async () => {
    if (!activeLead) return;
    try {
      const res = await fetch("/api/university/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: activeLead.phone,
          toggleMode: true,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setConvMode(data.mode);
      }
    } catch (err) {
      console.error("Failed to toggle mode:", err);
    }
  };

  // Update lead status
  const handleStatusChange = async (leadId: string, newStatus: string) => {
    try {
      const res = await fetch("/api/university/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_status",
          leadId,
          status: newStatus,
        }),
      });

      if (res.ok) {
        setLeads((prev) =>
          prev.map((l) => (l.id === leadId ? { ...l, lead_status: newStatus as StudentLead["lead_status"] } : l))
        );
        if (activeLead && activeLead.id === leadId) {
          setActiveLead((prev) => (prev ? { ...prev, lead_status: newStatus as StudentLead["lead_status"] } : null));
        }
      }
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  // Add Walk-in Lead
  const handleCreateWalkinLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLeadForm.phone) return;

    try {
      const res = await fetch("/api/university/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: newLeadForm.phone,
          fullName: newLeadForm.fullName || null,
          programInterest: newLeadForm.programInterest,
          priorQualification: newLeadForm.priorQualification,
          percentageMarks: newLeadForm.percentageMarks ? Number(newLeadForm.percentageMarks) : null,
          notes: newLeadForm.notes || "Walk-in lead registered at DEC Gilgit",
          source: "dec_walkin",
          leadStatus: "visited_dec",
        }),
      });

      if (res.ok) {
        setShowAddModal(false);
        setNewLeadForm({
          fullName: "",
          phone: "",
          programInterest: "BBA",
          priorQualification: "FA/FSc",
          percentageMarks: "",
          notes: "",
        });
        await fetchLeadsAndStats();
      }
    } catch (err) {
      console.error("Failed to add walk-in lead:", err);
    }
  };

  // Filtered Leads
  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const matchesSearch =
        !searchQuery ||
        (lead.full_name && lead.full_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        lead.phone.includes(searchQuery) ||
        (lead.prior_qualification && lead.prior_qualification.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesProgram =
        selectedProgram === "All" ||
        (lead.program_interest && lead.program_interest.toLowerCase().includes(selectedProgram.toLowerCase()));

      const matchesStatus =
        selectedStatus === "All" || lead.lead_status === selectedStatus;

      return matchesSearch && matchesProgram && matchesStatus;
    });
  }, [leads, searchQuery, selectedProgram, selectedStatus]);

  // Export CSV
  const handleExportCSV = () => {
    if (leads.length === 0) return;

    const headers = [
      "Student Name",
      "Phone Number",
      "Program Interested",
      "Degree Level",
      "Prior Qualification",
      "Percentage Marks",
      "Status",
      "Source",
      "Counselor Notes",
      "Registered Date",
    ];

    const rows = filteredLeads.map((l) => [
      `"${l.full_name || "Unspecified"}"`,
      `"${l.phone}"`,
      `"${l.program_interest || "N/A"}"`,
      `"${l.degree_level || "N/A"}"`,
      `"${l.prior_qualification || "N/A"}"`,
      `"${l.percentage_marks || ""}"`,
      `"${STATUS_CONFIG[l.lead_status]?.label || l.lead_status}"`,
      `"${l.source || "Meta Ads"}"`,
      `"${(l.counselor_notes || "").replace(/"/g, '""')}"`,
      `"${new Date(l.created_at).toLocaleDateString()}"`,
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `sarhad_university_dec_gilgit_leads_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Header / University Banner */}
      <header className="bg-[#0f172a] text-white border-b border-slate-800 sticky top-0 z-30 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-300 flex items-center justify-center text-slate-900 shadow-lg shadow-amber-500/20">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-lg tracking-tight text-white">
                  Sarhad University of Science & IT
                </h1>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Admissions Open
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Distance Education Center (DEC) – Alam Public School & College, Jutial, Gilgit
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-xs text-slate-300">
              <Calendar className="w-4 h-4 text-amber-400" />
              <span>Last Date: <strong className="text-amber-400">10 Sept 2026</strong></span>
              <span className="px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 text-[10px] font-bold">
                {daysRemaining} Days Left
              </span>
            </div>

            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Add Walk-in Lead
            </button>

            <button
              onClick={fetchLeadsAndStats}
              title="Refresh"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex gap-6 text-xs font-medium border-t border-slate-800">
          <button
            onClick={() => setActiveTab("leads")}
            className={`py-2.5 border-b-2 transition ${
              activeTab === "leads"
                ? "border-amber-400 text-amber-400 font-bold"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Student Leads & WhatsApp CRM
          </button>
          <button
            onClick={() => setActiveTab("programs")}
            className={`py-2.5 border-b-2 transition ${
              activeTab === "programs"
                ? "border-amber-400 text-amber-400 font-bold"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Programs & Degree Options
          </button>
          <button
            onClick={() => setActiveTab("dec_info")}
            className={`py-2.5 border-b-2 transition ${
              activeTab === "dec_info"
                ? "border-amber-400 text-amber-400 font-bold"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            DEC Gilgit Center & Schedule
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full flex-1">
        {/* KPI Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{stats?.totalLeads ?? leads.length}</div>
              <div className="text-xs text-slate-500">Total Student Leads</div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{stats?.newLeadsToday ?? 0}</div>
              <div className="text-xs text-slate-500">Inquiries Today (Ads)</div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
              <Building className="w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{stats?.visitedCount ?? 0}</div>
              <div className="text-xs text-slate-500">Visited DEC Center</div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{stats?.enrolledCount ?? 0}</div>
              <div className="text-xs text-slate-500">Confirmed Enrolled</div>
            </div>
          </div>
        </div>

        {/* Tab 1: Leads CRM */}
        {activeTab === "leads" && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            {/* Filters and Controls */}
            <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              <div className="flex flex-1 items-center gap-2 max-w-md bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                <Search className="w-4 h-4 text-slate-400 shrink-0" />
                <input
                  type="text"
                  placeholder="Search student name, phone number, qualification..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent text-xs text-slate-900 placeholder:text-slate-400 focus:outline-hidden w-full"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Program Filter */}
                <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
                  <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                  <select
                    value={selectedProgram}
                    onChange={(e) => setSelectedProgram(e.target.value)}
                    className="bg-transparent focus:outline-hidden cursor-pointer font-medium text-slate-800"
                  >
                    {PROGRAM_OPTIONS.map((prog) => (
                      <option key={prog} value={prog}>
                        {prog === "All" ? "All Programs" : prog}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status Filter */}
                <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
                  <Filter className="w-3.5 h-3.5 text-slate-400" />
                  <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value)}
                    className="bg-transparent focus:outline-hidden cursor-pointer font-medium text-slate-800"
                  >
                    <option value="All">All Statuses</option>
                    <option value="new">New Inquiries</option>
                    <option value="contacted">Contacted</option>
                    <option value="visit_planned">Visit Planned</option>
                    <option value="visited_dec">Visited DEC</option>
                    <option value="enrolled">Enrolled</option>
                    <option value="lost">Lost / Ineligible</option>
                  </select>
                </div>

                {/* Export CSV */}
                <button
                  onClick={handleExportCSV}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-medium text-xs transition shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export CSV ({filteredLeads.length})
                </button>
              </div>
            </div>

            {/* Leads Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50/80 text-slate-500 font-semibold border-b border-slate-100 uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="px-4 py-3">Student / Phone</th>
                    <th className="px-4 py-3">Interested Program</th>
                    <th className="px-4 py-3">Degree Option & Qual</th>
                    <th className="px-4 py-3">Eligibility</th>
                    <th className="px-4 py-3">Lead Status</th>
                    <th className="px-4 py-3">Source / Date</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLeads.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                        {loading ? (
                          <div className="flex flex-col items-center gap-2">
                            <RefreshCw className="w-6 h-6 animate-spin text-amber-500" />
                            <span>Loading student leads from DEC Gilgit database...</span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-2">
                            <Users className="w-8 h-8 text-slate-300" />
                            <span className="font-medium text-slate-600">No student leads found</span>
                            <span className="text-xs text-slate-400">
                              Leads will appear here automatically when students click your Meta Ads or WhatsApp.
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : (
                    filteredLeads.map((lead) => {
                      const statusInfo = STATUS_CONFIG[lead.lead_status] || STATUS_CONFIG.new;
                      return (
                        <tr
                          key={lead.id}
                          className="hover:bg-slate-50/60 transition cursor-pointer"
                          onClick={() => openLeadDrawer(lead)}
                        >
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900">
                              {lead.full_name || "Prospective Student"}
                            </div>
                            <div className="flex items-center gap-1.5 text-slate-500 font-mono text-[11px]">
                              <Phone className="w-3 h-3 text-slate-400" />
                              +{lead.phone}
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            {lead.program_interest ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md font-semibold text-xs bg-slate-100 text-slate-800">
                                {lead.program_interest}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">Exploring</span>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <div className="text-slate-800 font-medium">
                              {lead.prior_qualification || "FA / FSc"}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {lead.degree_level || "2-Year ADP / 4-Year BS"}
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            {lead.percentage_marks ? (
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                                  lead.percentage_marks >= 45
                                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                    : "bg-rose-50 text-rose-700 border border-rose-200"
                                }`}
                              >
                                {lead.percentage_marks >= 45 ? (
                                  <CheckCircle2 className="w-3 h-3" />
                                ) : (
                                  <AlertCircle className="w-3 h-3" />
                                )}
                                {lead.percentage_marks}% ({lead.percentage_marks >= 45 ? "Eligible" : "Under 45%"})
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[11px]">Pending verification</span>
                            )}
                          </td>

                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <select
                              value={lead.lead_status}
                              onChange={(e) => handleStatusChange(lead.id, e.target.value)}
                              className={`text-[11px] font-bold px-2 py-1 rounded-md border cursor-pointer focus:outline-hidden ${statusInfo.bg} ${statusInfo.text} ${statusInfo.border}`}
                            >
                              <option value="new">New Inquiry</option>
                              <option value="contacted">Contacted</option>
                              <option value="visit_planned">Visit Planned</option>
                              <option value="visited_dec">Visited DEC</option>
                              <option value="enrolled">Enrolled</option>
                              <option value="lost">Lost</option>
                            </select>
                          </td>

                          <td className="px-4 py-3">
                            <div className="capitalize text-slate-700 font-medium">
                              {lead.source?.replace("_", " ") || "Meta Ad"}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {new Date(lead.last_message_at || lead.created_at).toLocaleDateString([], {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </div>
                          </td>

                          <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5">
                              <a
                                href={`https://wa.me/${lead.phone}`}
                                target="_blank"
                                rel="noreferrer"
                                title="Open WhatsApp Chat"
                                className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                              </a>
                              <button
                                onClick={() => openLeadDrawer(lead)}
                                title="View Conversation Transcript"
                                className="p-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition"
                              >
                                <ChevronRight className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: Programs & Degree Options Information */}
        {activeTab === "programs" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs md:col-span-2">
              <h2 className="font-bold text-base text-slate-900 mb-2 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-amber-500" />
                Available Programs for Fall 2026 Admissions
              </h2>
              <p className="text-xs text-slate-500 mb-4">
                Sarhad University Distance Education Center (DEC), Alam Public School & College, Jutial, Gilgit offers 6 programs under flexible distance learning:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                {[
                  { name: "BBA (Business Administration)", desc: "Marketing, finance, management, and entrepreneurship." },
                  { name: "B.Ed (Bachelor of Education)", desc: "Modern teacher training, pedagogy, and educational leadership." },
                  { name: "English", desc: "English literature, linguistics, grammar, and professional communication." },
                  { name: "Education", desc: "Educational foundations, curriculum design, and child psychology." },
                  { name: "Urdu", desc: "Classical and contemporary Urdu literature, critique, and poetry." },
                  { name: "Health & Physical Education", desc: "Sports sciences, human physiology, physical fitness, and health." },
                ].map((p, idx) => (
                  <div key={idx} className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                    <div className="font-bold text-slate-800 text-xs">{idx + 1}. {p.name}</div>
                    <div className="text-[11px] text-slate-500 mt-1">{p.desc}</div>
                  </div>
                ))}
              </div>

              <h3 className="font-bold text-sm text-slate-900 mb-2">Program Options According to Qualification:</h3>
              <div className="space-y-3">
                <div className="p-3.5 rounded-lg bg-blue-50/50 border border-blue-100">
                  <div className="font-bold text-blue-950 text-xs">🎓 After FA / FSc / ICS / I.Com:</div>
                  <ul className="text-xs text-blue-800 mt-1 list-disc list-inside space-y-1">
                    <li><strong>2-Year Associate Degree Program (ADP):</strong> 4 Semesters, equivalent to traditional 2-year graduation. Fast-track and career focused.</li>
                    <li><strong>4-Year BS Program:</strong> 8 Semesters, complete 16-year honours degree.</li>
                  </ul>
                </div>

                <div className="p-3.5 rounded-lg bg-emerald-50/50 border border-emerald-100">
                  <div className="font-bold text-emerald-950 text-xs">🎓 After 2-Year Graduation (BA / BSc / B.Com / ADP):</div>
                  <ul className="text-xs text-emerald-800 mt-1 list-disc list-inside">
                    <li><strong>2.5-Year BS Program:</strong> 5 Semesters bridge degree converting your 14-year education into a full 16-year HEC-recognized BS degree!</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Eligibility & Exam Rules */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-5">
              <div>
                <h3 className="font-bold text-sm text-slate-900 mb-2 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Eligibility Criteria
                </h3>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100 text-xs text-slate-600 space-y-2">
                  <p>• <strong>Minimum 45% marks</strong> are strictly required in the previous qualification.</p>
                  <p>• Both Science (Pre-Med / Pre-Eng / ICS) and Arts / Humanities / Commerce students are eligible.</p>
                </div>
              </div>

              <div>
                <h3 className="font-bold text-sm text-slate-900 mb-2 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-amber-500" />
                  Course & Exam Structure
                </h3>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100 text-xs text-slate-600 space-y-1.5">
                  <p>• <strong>LMS Access:</strong> Students receive LMS IDs with 24/7 recorded video lectures.</p>
                  <p>• <strong>Topics:</strong> ~25 prescribed topics per subject from the course outline.</p>
                  <p>• <strong>Examination:</strong> 70-mark paper at semester end according to university examination system.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: DEC Gilgit Center & Schedule Info */}
        {activeTab === "dec_info" && (
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs max-w-4xl mx-auto space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                <Building className="w-5 h-5 text-blue-600" />
                Distance Education Center (DEC) – Alam Public School & College, Jutial, Gilgit
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Official Admission, Registration, Guidance & Examination Center for Gilgit-Baltistan.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <h3 className="font-bold text-sm text-slate-800 mb-2">📍 Center Location</h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Distance Education Center (DEC),<br />
                  Alam Public School & College,<br />
                  Jutial, Gilgit, Gilgit-Baltistan.
                </p>
                <div className="mt-3 text-xs font-semibold text-blue-600">
                  Last Date to Apply: 10 September 2026 ({daysRemaining} days left)
                </div>
              </div>

              <div className="p-4 rounded-xl bg-amber-50/50 border border-amber-200">
                <h3 className="font-bold text-sm text-amber-900 mb-2">🏫 Physical Classes vs Distance Learning</h3>
                <p className="text-xs text-amber-800 leading-relaxed">
                  📌 <strong>Sunday Physical Classes:</strong> Conducted every Sunday at DEC Alam Public School & College Jutial.<br /><br />
                  ➡️ <strong>Sunday classes are OPTIONAL!</strong> Students who cannot attend in person can continue 100% of their studies through LMS recorded lectures anytime.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-emerald-50/40 border border-emerald-200 text-xs text-emerald-900 space-y-2">
              <div className="font-bold text-emerald-950 text-sm">⭐ Tailored for Working Professionals & Teachers</div>
              <p>
                This Distance Learning Program is designed specifically for school/college teachers, government employees, private sector professionals, and students residing in remote valleys who cannot travel daily for university classes.
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Slide-over Drawer: Student Conversation & Counselor Takeover */}
      {activeLead && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex justify-end">
          <div className="w-full max-w-xl bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div>
                <div className="font-bold text-sm flex items-center gap-2">
                  <span>{activeLead.full_name || "Prospective Student"}</span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                      convMode === "human"
                        ? "bg-amber-500 text-slate-950 font-bold"
                        : "bg-blue-500/20 text-blue-300"
                    }`}
                  >
                    {convMode === "human" ? "Manual Mode" : "AI Bot Active"}
                  </span>
                </div>
                <div className="text-xs text-slate-400 font-mono">+{activeLead.phone}</div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleToggleMode}
                  title="Toggle between AI automatic replies and manual counselor replies"
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition"
                >
                  {convMode === "human" ? "Resume AI Bot" : "Takeover Chat"}
                </button>
                <button
                  onClick={() => setActiveLead(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Lead Quick Facts */}
            <div className="p-3 bg-slate-50 border-b border-slate-200 grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <span className="text-slate-400 block">Program:</span>
                <span className="font-bold text-slate-800">{activeLead.program_interest || "Not specified"}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Qualification:</span>
                <span className="font-bold text-slate-800">{activeLead.prior_qualification || "FA/FSc"}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Status:</span>
                <span className="font-bold text-slate-800 capitalize">{activeLead.lead_status.replace("_", " ")}</span>
              </div>
            </div>

            {/* Conversation Log */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-100/50">
              {chatLoading ? (
                <div className="flex justify-center py-10 text-xs text-slate-400">
                  <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading chat transcript...
                </div>
              ) : chatMessages.length === 0 ? (
                <div className="text-center py-10 text-xs text-slate-400">
                  No messages recorded yet.
                </div>
              ) : (
                chatMessages.map((msg) => {
                  const isUser = msg.role === "user";
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isUser ? "items-start" : "items-end"}`}
                    >
                      <div className="text-[10px] text-slate-400 mb-0.5 px-1 font-medium">
                        {isUser ? "Student" : msg.sender_kind === "human" ? "Counselor (Staff)" : "AI Assistant"} •{" "}
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div
                        className={`p-3 rounded-2xl max-w-[85%] text-xs leading-relaxed whitespace-pre-wrap shadow-xs ${
                          isUser
                            ? "bg-white text-slate-800 border border-slate-200 rounded-tl-xs"
                            : msg.sender_kind === "human"
                            ? "bg-amber-500 text-slate-950 font-medium rounded-tr-xs"
                            : "bg-[#0f172a] text-slate-100 rounded-tr-xs"
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Counselor Manual Reply Input */}
            <div className="p-3 bg-white border-t border-slate-200 flex items-center gap-2">
              <input
                type="text"
                placeholder={
                  convMode === "human"
                    ? "Type manual reply to student's WhatsApp..."
                    : "Type message (will send directly to student)..."
                }
                value={counselorReply}
                onChange={(e) => setCounselorReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendCounselorMessage();
                  }
                }}
                className="flex-1 bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg text-xs text-slate-900 focus:outline-hidden focus:border-amber-500"
              />
              <button
                onClick={handleSendCounselorMessage}
                disabled={sendingReply || !counselorReply.trim()}
                className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition"
              >
                <Send className="w-3.5 h-3.5" />
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add Walk-in Student Lead */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900">Add Walk-in Student Lead</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateWalkinLead} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Student Full Name</label>
                <input
                  type="text"
                  placeholder="e.g. Muhammad Ali"
                  value={newLeadForm.fullName}
                  onChange={(e) => setNewLeadForm({ ...newLeadForm, fullName: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:outline-hidden focus:border-amber-500 text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">WhatsApp Phone Number *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 923151234567"
                  value={newLeadForm.phone}
                  onChange={(e) => setNewLeadForm({ ...newLeadForm, phone: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:outline-hidden focus:border-amber-500 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Program of Interest</label>
                  <select
                    value={newLeadForm.programInterest}
                    onChange={(e) => setNewLeadForm({ ...newLeadForm, programInterest: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:outline-hidden focus:border-amber-500 text-xs"
                  >
                    <option value="BBA">BBA</option>
                    <option value="B.Ed">B.Ed</option>
                    <option value="English">English</option>
                    <option value="Education">Education</option>
                    <option value="Urdu">Urdu</option>
                    <option value="Health & Physical Education">Health & Phys Ed</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Prior Qualification</label>
                  <select
                    value={newLeadForm.priorQualification}
                    onChange={(e) => setNewLeadForm({ ...newLeadForm, priorQualification: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:outline-hidden focus:border-amber-500 text-xs"
                  >
                    <option value="FA/FSc">FA / FSc (Inter)</option>
                    <option value="Graduation (BA/BSc)">Graduation (BA/BSc)</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Percentage Marks (%)</label>
                <input
                  type="number"
                  placeholder="e.g. 55"
                  value={newLeadForm.percentageMarks}
                  onChange={(e) => setNewLeadForm({ ...newLeadForm, percentageMarks: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:outline-hidden focus:border-amber-500 text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Counselor Notes / Inquiries</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Student visited center, interested in Sunday classes..."
                  value={newLeadForm.notes}
                  onChange={(e) => setNewLeadForm({ ...newLeadForm, notes: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:outline-hidden focus:border-amber-500 text-xs"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
                >
                  Save Lead
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
