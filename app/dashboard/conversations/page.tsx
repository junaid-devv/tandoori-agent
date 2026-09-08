"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { clsx } from "clsx";
import { format, formatDistanceToNow, isSameDay } from "date-fns";
import {
  ArrowLeft,
  Bot,
  Check,
  CheckCheck,
  Copy,
  Info,
  Loader2,
  MessageSquare,
  MessageSquareText,
  Mic,
  Package,
  PanelRightClose,
  PanelRightOpen,
  Phone,
  RefreshCw,
  Search,
  SendHorizonal,
  ShoppingCart,
  Sparkles,
  User,
  UserCheck,
  UserRound,
  Users,
  Volume2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";
import { useDataCache, invalidateCache } from "@/lib/useDataCache";
import { DemoController, type DemoControllerState } from "@/demo/controllers/demo-controller";

// --- Types ---
type ConversationMode = "agent" | "human";
type SenderKind = "user" | "ai" | "human" | "system" | string;

interface ConversationState {
  stage?: string | null;
  workflow_step?: string | null;
  order_type: string | null;
  address: string | null;
  guests: number | null;
  reservation_time: string | null;
  pickup_time: string | null;
  cart: unknown;
  last_error: string | null;
  is_bot_active?: boolean | null;
  invalid_step_count?: number | null;
  anger_level?: number | null;
  last_intent?: string | null;
  escalation_reason?: string | null;
  escalated_at?: string | null;
}

interface UserSessionState {
  active_node: string | null;
  status: string | null;
  is_bot_active: boolean | null;
  invalid_step_count: number | null;
  escalation_reason: string | null;
  escalated_at: string | null;
}

interface SavedAddress {
  id: string;
  label: string;
  address: string;
  use_count: number;
  last_used_at: string;
}

interface CustomerProfile {
  id: string;
  phone?: string;
  name?: string | null;
  preferred_language: string;
  tags: unknown;
  notes: string | null;
  total_orders: number;
  last_order_at: string | null;
  customer_addresses?: SavedAddress[];
}

interface ConversationPreview {
  id: string;
  branch_id: string;
  phone: string;
  name: string | null;
  mode: ConversationMode;
  has_unread: boolean;
  last_message_at?: string;
  updated_at: string;
  created_at: string;
  branches?: { id: string; name: string; slug: string; address: string } | null;
  contacts?: CustomerProfile | CustomerProfile[] | null;
  conversation_states?: ConversationState | ConversationState[] | null;
  user_sessions?: UserSessionState | UserSessionState[] | null;
  messages?: Array<{
    content: string;
    role: string;
    sender_kind: SenderKind;
    delivery_status?: string | null;
    created_at: string;
  }>;
}

type ConversationDetail = Omit<ConversationPreview, "messages">;

interface Message {
  id: string;
  ingest_seq: number;
  conversation_id: string;
  role: string;
  sender_kind: SenderKind;
  content: string;
  whatsapp_msg_id?: string | null;
  created_at: string;
  delivery_status?: string | null;
  delivery_error?: string | null;
  delivery_status_updated_at?: string | null;
  replyButtons?: Array<{ id: string; title: string }>;
  listSelector?: {
    title: string;
    buttonText: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  };
  audioUrl?: string | null;
  isVoiceNote?: boolean;
  transcript?: string | null;
}

interface MessageResponse {
  messages: Message[];
  hasMore: boolean;
}

interface DraftLine {
  name: string;
  qty: number;
  size?: string | null;
  addons?: string[] | null;
  notes?: string | null;
}

const CANNED_RESPONSES = [
  "Salam! How may I assist you with your order today?",
  "Your order has been received and is being prepared with care.",
  "Our delivery rider has been dispatched to your address.",
  "Please share your complete delivery address or street landmark.",
  "Could you please confirm if this order is for Delivery, Pickup, or Dine-in?",
  "Thank you for reaching out! We appreciate your patience.",
];

function pickState(
  state?: ConversationState | ConversationState[] | null
): ConversationState | null {
  if (!state) return null;
  return Array.isArray(state) ? state[0] ?? null : state;
}

function pickSession(
  session?: UserSessionState | UserSessionState[] | null,
  state?: ConversationState | ConversationState[] | null
): UserSessionState | null {
  if (session) return Array.isArray(session) ? session[0] ?? null : session;
  const s = pickState(state);
  if (!s) return null;
  const isHandoff = s.stage === "human" || Boolean(s.escalation_reason) || s.is_bot_active === false;
  return {
    active_node: s.stage ?? "cart_builder",
    status: isHandoff ? "human_handoff" : s.is_bot_active ? "active" : "paused",
    is_bot_active: !isHandoff && (s.is_bot_active ?? true),
    invalid_step_count: s.invalid_step_count ?? 0,
    escalation_reason: s.escalation_reason ?? null,
    escalated_at: s.escalated_at ?? null,
  };
}

function getDraftLines(cart: unknown): DraftLine[] {
  const rawItems =
    Array.isArray(cart) ? cart : cart && typeof cart === "object" && Array.isArray((cart as { items?: unknown[] }).items)
      ? (cart as { items: unknown[] }).items
      : [];

  return rawItems
    .map((item): DraftLine | null => {
      if (!item || typeof item !== "object") return null;
      
      const record = item as Record<string, unknown>;
      const name = String(record.name ?? record.title ?? record.item ?? "").trim();
      const qty = Number(record.qty ?? record.quantity ?? 1);
      const size = typeof record.size === "string" ? record.size : null;
      const addons = Array.isArray(record.addons)
        ? record.addons.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : [];
      const notes =
        typeof record.item_instructions === "string"
          ? record.item_instructions
          : typeof record.notes === "string"
            ? record.notes
            : null;
      
      if (!name) return null;
      
      return { 
        name, 
        qty: Number.isFinite(qty) && qty > 0 ? qty : 1, 
        size,
        addons,
        notes 
      };
    })
    .filter((line): line is DraftLine => line !== null);
}

function getConversationLabel(conversation: ConversationPreview | ConversationDetail | null) {
  if (!conversation) return "Unknown customer";
  return conversation.name?.trim() || conversation.phone;
}

function getConversationInitials(conversation: ConversationPreview | ConversationDetail | null) {
  const label = getConversationLabel(conversation);
  return label
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "CU";
}

function getPreviewMessage(conversation: ConversationPreview) {
  const latest = conversation.messages?.[0];
  if (!latest?.content) return "No messages yet";
  let clean = latest.content.replace(/\\n/g, " ").replace(/\n/g, " ");
  clean = clean.replace(/\*\*?/g, "");
  return clean.length > 80 ? `${clean.slice(0, 80)}...` : clean;
}

function formatStep(step: string | null | undefined) {
  if (!step) return "Ready";
  return step.replaceAll("_", " ");
}

function formatMessageDay(dateText: string) {
  return format(new Date(dateText), "EEEE, dd MMM yyyy");
}

function renderMessageContent(content: string) {
  if (!content) return "";
  const text = content.replace(/\\n/g, "\n");
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const parts = text.split(regex);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i} className="font-extrabold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <strong key={i} className="font-extrabold">{part.slice(1, -1)}</strong>;
    }
    return part;
  });
}

function pickContact(contact?: CustomerProfile | CustomerProfile[] | null): CustomerProfile | null {
  if (!contact) return null;
  return Array.isArray(contact) ? contact[0] ?? null : contact;
}

function getTags(contact: CustomerProfile | null): string[] {
  return Array.isArray(contact?.tags)
    ? contact.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : [];
}

function compareMessagesByTimeline(left: Message, right: Message) {
  const leftTime = new Date(left.created_at).getTime();
  const rightTime = new Date(right.created_at).getTime();
  const leftValid = Number.isFinite(leftTime);
  const rightValid = Number.isFinite(rightTime);

  if (leftValid && rightValid && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  if (leftValid && !rightValid) return -1;
  if (!leftValid && rightValid) return 1;

  return left.ingest_seq - right.ingest_seq;
}

function mergeAndSortMessages(items: Message[]) {
  const byId = new Map<string, Message>();
  for (const item of items) {
    byId.set(item.id, item);
  }

  return [...byId.values()].sort(compareMessagesByTimeline);
}

export default function ConversationsPage() {
  const {
    selectedBranchId,
    selectedBranch,
    isContextPanelOpen,
    toggleContextPanelOpen,
  } = useDashboardContext();

  const searchParams = useSearchParams();
  const requestedConversationId = useMemo(() => searchParams.get("conversation_id"), [searchParams]);

  // Local conversations state
  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [modeSaving, setModeSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [inboxFilter, setInboxFilter] = useState<"all" | "unread" | "human" | "cart">("all");
  const [composer, setComposer] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [customerTags, setCustomerTags] = useState("");
  const [savingCustomerProfile, setSavingCustomerProfile] = useState(false);
  const [demoState, setDemoState] = useState<DemoControllerState | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (!window.__DEMO_CONTROLLER__) {
        window.__DEMO_CONTROLLER__ = new DemoController();
      }
      const controller = window.__DEMO_CONTROLLER__;
      setDemoState(controller.getState());
      return controller.subscribe(() => {
        setDemoState(controller.getState());
      });
    }
  }, []);

  const selectedIdRef = useRef<string | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const endRef = useRef<HTMLDivElement>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);

  const isViewportNearBottom = useCallback(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return true;
    const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    return remaining <= 100;
  }, []);

  // Conversations list query with stale-while-revalidate
  const conversationsUrl = useMemo(() => {
    const branchQuery = selectedBranchId === "all" ? "" : `&branch_id=${encodeURIComponent(selectedBranchId)}`;
    return `/api/conversations?limit=100${branchQuery}`;
  }, [selectedBranchId]);

  const {
    data: cachedConversations,
    isLoading: loadingList,
    revalidate: revalidateList,
  } = useDataCache<ConversationPreview[]>(conversationsUrl);

  // Sync cached data into local state
  useEffect(() => {
    if (cachedConversations) {
      setConversations(cachedConversations);
      setSelectedId((current) => {
        if (requestedConversationId && cachedConversations.some((item) => item.id === requestedConversationId)) {
          return requestedConversationId;
        }
        if (current && cachedConversations.some((item) => item.id === current)) {
          return current;
        }
        // Auto-select first conversation ONLY on desktop viewports (>= 768px)
        const isDesktop = typeof window !== "undefined" && window.innerWidth >= 768;
        return isDesktop ? (cachedConversations[0]?.id ?? null) : null;
      });
    }
  }, [cachedConversations, requestedConversationId]);

  const loadConversations = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    invalidateCache("/api/conversations");
    revalidateList();
    if (showRefreshing) setTimeout(() => setRefreshing(false), 500);
  }, [revalidateList]);

  const loadConversation = useCallback(async (conversationId: string) => {
    const response = await fetch(`/api/conversations/${conversationId}`, {
      cache: "no-store",
      headers: { "ngrok-skip-browser-warning": "69420" },
    });

    if (!response.ok) throw new Error("Failed to load conversation");
    setConversation((await response.json()) as ConversationDetail);
  }, []);

  const loadMessages = useCallback(
    async (conversationId: string, beforeSeq?: number, options?: { forceStickToBottom?: boolean }) => {
      const isOlderRequest = typeof beforeSeq === "number";
      if (isOlderRequest) {
        setLoadingOlder(true);
        shouldStickToBottomRef.current = false;
      } else {
        setLoadingMessages(true);
        shouldStickToBottomRef.current = options?.forceStickToBottom ?? isViewportNearBottom();
      }

      try {
        const params = new URLSearchParams({ limit: "50" });
        if (beforeSeq != null) params.set("before_seq", String(beforeSeq));
        const response = await fetch(`/api/conversations/${conversationId}/messages?${params.toString()}`, {
          cache: "no-store",
          headers: { "ngrok-skip-browser-warning": "69420" },
        });
        if (!response.ok) throw new Error("Failed to load messages");

        const data = (await response.json()) as MessageResponse;
        setMessages((current) => mergeAndSortMessages(isOlderRequest ? [...data.messages, ...current] : data.messages));
        setHasMoreMessages(data.hasMore);
      } catch (error) {
        console.error(error);
        toast.error("Failed to load messages.");
      } finally {
        setLoadingMessages(false);
        setLoadingOlder(false);
      }
    },
    [isViewportNearBottom]
  );

  // Mark conversation read WITHOUT altering last_message_at or jumping to top
  const markConversationRead = useCallback(async (conversationId: string) => {
    setConversations((current) =>
      current.map((item) => (item.id === conversationId ? { ...item, has_unread: false } : item))
    );

    try {
      await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ has_unread: false }),
      });
    } catch {
      // Handled silently
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setConversation(null);
      setMessages([]);
      return;
    }

    void loadConversation(selectedId);
    void loadMessages(selectedId, undefined, { forceStickToBottom: true });
    void markConversationRead(selectedId);
  }, [loadConversation, loadMessages, markConversationRead, selectedId]);

  // Periodic polling (12s)
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      invalidateCache("/api/conversations");
      revalidateList();
      if (selectedIdRef.current) void loadConversation(selectedIdRef.current);
      if (selectedIdRef.current) void loadMessages(selectedIdRef.current);
    }, 12000);
    return () => {
      window.clearInterval(interval);
    };
  }, [loadConversation, loadMessages, revalidateList]);

  // Derived filter counts
  const filterCounts = useMemo(() => {
    let unread = 0;
    let human = 0;
    let cart = 0;
    conversations.forEach((item) => {
      if (item.has_unread) unread++;
      const session = pickSession(item.user_sessions, item.conversation_states);
      if (item.mode === "human" || session?.status === "human_handoff") human++;
      const draft = getDraftLines(pickState(item.conversation_states)?.cart);
      if (draft.length > 0) cart++;
    });
    return { all: conversations.length, unread, human, cart };
  }, [conversations]);

  const filteredConversations = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return conversations.filter((item) => {
      const session = pickSession(item.user_sessions, item.conversation_states);
      const state = pickState(item.conversation_states);
      const draft = getDraftLines(state?.cart);

      if (inboxFilter === "unread" && !item.has_unread) return false;
      if (inboxFilter === "human" && item.mode !== "human" && session?.status !== "human_handoff") return false;
      if (inboxFilter === "cart" && draft.length === 0) return false;

      if (!query) return true;

      const latest = item.messages?.[0]?.content ?? "";
      const step = state?.stage ?? state?.workflow_step ?? "";
      return [item.name ?? "", item.phone, latest, step].some((value) => value.toLowerCase().includes(query));
    });
  }, [conversations, inboxFilter, searchTerm]);

  const activePreview = useMemo(
    () => conversations.find((item) => item.id === selectedId) ?? null,
    [conversations, selectedId]
  );
  const activeConversation = conversation ?? activePreview;
  const activeState = pickState(activeConversation?.conversation_states);
  const activeSession = pickSession(activeConversation?.user_sessions, activeConversation?.conversation_states);
  const activeContact = pickContact(activeConversation?.contacts);
  const activeTags = getTags(activeContact);
  const activeTagText = activeTags.join(", ");
  const rawDraftLines = getDraftLines(activeState?.cart);
  const isDemoContact = activeConversation?.phone === "+923331234567" || activeConversation?.name === "Ahmed Khan" || activeConversation?.phone === "+923001234567" || activeConversation?.name === "Tariq Mahmood";

  const displayMessages = useMemo(() => {
    if (isDemoContact && demoState && demoState.activeMessages.length > 0) {
      return demoState.activeMessages.map((dm, idx) => ({
        id: dm.id,
        ingest_seq: idx + 1,
        conversation_id: activeConversation?.id || "demo-conv",
        role: dm.sender_kind === "user" ? "user" : "assistant",
        sender_kind: dm.sender_kind,
        content: dm.content,
        created_at: new Date(Date.now() - (demoState.activeMessages.length - idx) * 10000).toISOString(),
        delivery_status: dm.deliveryStatus || "delivered",
        replyButtons: dm.replyButtons,
        listSelector: dm.listSelector,
        audioUrl: (dm as any).audioUrl || null,
        isVoiceNote: (dm as any).isVoiceNote || false,
        transcript: (dm as any).transcript || null,
      })) as Message[];
    }
    return messages;
  }, [isDemoContact, demoState, messages, activeConversation?.id]);

  const displayDraftLines = useMemo(() => {
    if (isDemoContact && demoState && demoState.cart.length > 0) {
      return demoState.cart.map((item) => ({
        name: item.name,
        qty: item.qty,
        size: item.size || null,
        addons: item.addons || [],
        notes: null,
      }));
    }
    return rawDraftLines;
  }, [isDemoContact, demoState, rawDraftLines]);

  const displayDraftItemCount = displayDraftLines.reduce((sum: number, item: { qty: number }) => sum + item.qty, 0);
  const displayWorkflowStep = isDemoContact && demoState ? demoState.workflowStep : (activeState?.stage ?? activeState?.workflow_step);

  const oldestLoadedIngestSeq = useMemo(() => {
    if (displayMessages.length === 0) return null;
    return displayMessages.reduce((min, item) => Math.min(min, item.ingest_seq), displayMessages[0].ingest_seq);
  }, [displayMessages]);

  useEffect(() => {
    if (isDemoContact && demoState) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    } else if (shouldStickToBottomRef.current) {
      endRef.current?.scrollIntoView({ block: "end" });
    }
  }, [displayMessages, demoState, isDemoContact]);

  const handleSend = async (messageText?: string) => {
    const textToSend = (messageText ?? composer).trim();
    if (!selectedId || !textToSend) return;
    setSending(true);
    shouldStickToBottomRef.current = true;

    try {
      const response = await fetch(`/api/conversations/${selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: textToSend }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to send message");

      if (!messageText) setComposer("");
      setMessages((current) => mergeAndSortMessages([...current, body as Message]));
      void loadConversations(true);
      void loadConversation(selectedId);
      toast.success("Message sent to customer.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  const handleModeChange = async (mode: ConversationMode) => {
    if (!selectedId || activeConversation?.mode === mode) return;
    setModeSaving(true);

    try {
      const response = await fetch(`/api/conversations/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to update mode");

      await Promise.all([loadConversation(selectedId), loadConversations(true), loadMessages(selectedId)]);
      toast.success(mode === "human" ? "You have taken over. AI Agent is paused." : "AI Agent re-enabled for this chat.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update mode.");
    } finally {
      setModeSaving(false);
    }
  };

  useEffect(() => {
    setCustomerNotes(activeContact?.notes ?? "");
    setCustomerTags(activeTagText);
  }, [activeContact?.id, activeContact?.notes, activeTagText]);

  const handleCustomerProfileSave = async () => {
    if (!selectedId) return;
    setSavingCustomerProfile(true);
    try {
      const tags = customerTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      const response = await fetch(`/api/conversations/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_notes: customerNotes,
          customer_tags: tags,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to save customer profile");
      await Promise.all([loadConversation(selectedId), loadConversations(true)]);
      toast.success("Customer profile updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save customer profile.");
    } finally {
      setSavingCustomerProfile(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-0 sm:min-h-[560px] w-full overflow-hidden rounded-xl sm:rounded-2xl border border-slate-200 bg-white font-sans text-slate-900 shadow-sm">
      
      {/* ─────────────────────────────────────────────────────────────
          PANE 1: INBOX LIST (w-80 / 320px)
         ───────────────────────────────────────────────────────────── */}
      <aside
        className={clsx(
          "flex min-w-0 shrink-0 flex-col border-r border-slate-200 bg-slate-50/50 transition-all duration-300 ease-in-out",
          selectedId ? "hidden w-full md:flex md:w-80 lg:w-[320px]" : "flex w-full md:w-80 lg:w-[320px]"
        )}
      >
        {/* Inbox Header & Search */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white p-3 sm:p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-slate-900">Conversations</h1>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                {conversations.length}
              </span>
            </div>
            <button
              onClick={() => void loadConversations(true)}
              disabled={loadingList || refreshing}
              className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              title="Refresh conversation list"
            >
              <RefreshCw size={13} className={clsx("mr-1.5", (loadingList || refreshing) && "animate-spin text-brand")} />
              <span>Sync</span>
            </button>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by customer, phone, message..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50/80 py-2 pl-9 pr-8 text-xs outline-none transition focus:border-brand/40 focus:bg-white focus:ring-2 focus:ring-brand/10"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Filter Pills */}
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1 text-[11px] font-semibold">
            {[
              { id: "all", label: "All", count: filterCounts.all },
              { id: "unread", label: "Unread", count: filterCounts.unread },
              { id: "human", label: "Human", count: filterCounts.human },
              { id: "cart", label: "Active", count: filterCounts.cart },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setInboxFilter(f.id as typeof inboxFilter)}
                className={clsx(
                  "flex items-center justify-center gap-1 rounded-lg py-1.5 transition capitalize",
                  inboxFilter === f.id
                    ? "bg-white text-slate-900 font-bold shadow-sm"
                    : "text-slate-500 hover:text-slate-900"
                )}
              >
                <span>{f.label}</span>
                {f.count > 0 && (
                  <span
                    className={clsx(
                      "rounded-full px-1 py-0.2 text-[9px] font-extrabold",
                      f.id === "unread" && f.count > 0
                        ? "bg-red-500 text-white"
                        : inboxFilter === f.id
                          ? "bg-slate-100 text-slate-700"
                          : "bg-slate-200/70 text-slate-500"
                    )}
                  >
                    {f.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Conversation List Scroll Area */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 overscroll-contain">
          {loadingList && conversations.length === 0 ? (
            <div className="space-y-2 p-1">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-20 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center text-slate-400">
              <MessageSquareText size={36} className="mb-2 opacity-25" />
              <p className="text-sm font-semibold text-slate-600">No chats found</p>
              <p className="text-xs text-slate-400 mt-0.5">Try adjusting your filters or search term</p>
            </div>
          ) : (
            filteredConversations.map((item) => {
              const state = pickState(item.conversation_states);
              const session = pickSession(item.user_sessions, item.conversation_states);
              const activeStep = state?.stage ?? state?.workflow_step;
              const isActive = item.id === selectedId;
              const draftLines = getDraftLines(state?.cart);
              
              // ACCURATE TIMESTAMP: Derived from last_message_at or first message's created_at, NOT updated_at!
              const displayTimestamp = item.last_message_at || item.messages?.[0]?.created_at || item.created_at;

              return (
                <button
                  key={item.id}
                  data-testid={`conversation-item-${item.phone.replace(/[^0-9]/g, "")}`}
                  onClick={() => setSelectedId(item.id)}
                  className={clsx(
                    "w-full rounded-xl p-2.5 text-left transition-all relative border group",
                    isActive
                      ? "bg-brand text-white shadow-md border-brand"
                      : "bg-white text-slate-800 border-slate-100 hover:border-slate-200 hover:bg-slate-50"
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    {/* Avatar with Mode Badge */}
                    <div className="relative shrink-0">
                      <div
                        className={clsx(
                          "flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold",
                          isActive ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700"
                        )}
                      >
                        {getConversationInitials(item)}
                      </div>
                      <div
                        className={clsx(
                          "absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border ring-1",
                          isActive
                            ? item.mode === "agent" ? "bg-emerald-500 text-white ring-brand" : "bg-amber-400 text-slate-900 ring-brand"
                            : item.mode === "agent" ? "bg-emerald-100 text-emerald-700 ring-white" : "bg-amber-100 text-amber-800 ring-white"
                        )}
                        title={item.mode === "agent" ? "AI Active" : "Human Mode"}
                      >
                        {item.mode === "agent" ? <Bot size={9} /> : <UserRound size={9} />}
                      </div>
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <p className={clsx("truncate text-xs font-bold", isActive ? "text-white" : "text-slate-900")}>
                          {getConversationLabel(item)}
                        </p>
                        <span className={clsx("shrink-0 text-[10px]", isActive ? "text-white/80 font-medium" : "text-slate-400 font-medium")}>
                          {formatDistanceToNow(new Date(displayTimestamp), { addSuffix: true })}
                        </span>
                      </div>

                      <p className={clsx("mt-0.5 line-clamp-1 text-[11px]", isActive ? "text-white/90" : "text-slate-500")}>
                        {getPreviewMessage(item)}
                      </p>

                      {/* Badges Bar */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {item.has_unread && (
                          <span className="inline-flex h-2 w-2 rounded-full bg-red-500 ring-2 ring-white animate-pulse" />
                        )}
                        {item.branches?.name && (
                          <span
                            className={clsx(
                              "rounded px-1.5 py-0.2 text-[9px] font-bold uppercase",
                              isActive ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"
                            )}
                          >
                            {item.branches.name}
                          </span>
                        )}
                        {activeStep && (
                          <span
                            className={clsx(
                              "rounded px-1.5 py-0.2 text-[9px] font-bold uppercase",
                              isActive ? "bg-white/15 text-white" : "bg-emerald-50 text-emerald-700"
                            )}
                          >
                            {formatStep(activeStep)}
                          </span>
                        )}
                        {draftLines.length > 0 && (
                          <span
                            className={clsx(
                              "flex items-center gap-0.5 rounded px-1.5 py-0.2 text-[9px] font-bold",
                              isActive ? "bg-white/20 text-white" : "bg-orange-50 text-brand"
                            )}
                          >
                            <ShoppingCart size={9} />
                            <span>{draftLines.length}</span>
                          </span>
                        )}
                        {session?.status === "human_handoff" && (
                          <span
                            className={clsx(
                              "rounded px-1.5 py-0.2 text-[9px] font-bold uppercase",
                              isActive ? "bg-amber-400 text-slate-900" : "bg-amber-100 text-amber-800"
                            )}
                          >
                            Handoff
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* ─────────────────────────────────────────────────────────────
          PANE 2: ACTIVE CHAT STREAM (Center)
         ───────────────────────────────────────────────────────────── */}
      <main className={clsx("flex min-w-0 flex-1 flex-col bg-slate-50/30", !selectedId ? "hidden md:flex" : "flex")}>
        {!activeConversation ? (
          <div className="flex h-full flex-col items-center justify-center bg-slate-50/50 p-6 text-center text-slate-400">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white border border-slate-200 shadow-sm mb-4">
              <MessageSquare size={28} className="text-slate-400" />
            </div>
            <h2 className="text-base font-bold text-slate-800">Select a conversation</h2>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              Choose a customer chat from the inbox list to view messages, place orders, or respond manually.
            </p>
          </div>
        ) : (
          <>
            {/* Chat Top Header */}
            <header className="flex-shrink-0 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
              <div className="flex items-center justify-between gap-3">
                {/* Left: Customer metadata */}
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={() => {
                      setSelectedId(null);
                      if (typeof window !== "undefined" && requestedConversationId) {
                        window.history.replaceState(null, "", "/dashboard/conversations");
                      }
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 md:hidden"
                    title="Back to inbox"
                  >
                    <ArrowLeft size={16} />
                  </button>

                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 font-bold text-brand text-sm">
                    {getConversationInitials(activeConversation)}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-base font-bold leading-tight text-slate-900">
                        {getConversationLabel(activeConversation)}
                      </h2>
                      {activeConversation.branches?.name && (
                        <span className="hidden sm:inline-block rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                          {activeConversation.branches.name}
                        </span>
                      )}
                    </div>

                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <button
                        onClick={() => copyToClipboard(activeConversation.phone, "Phone number")}
                        className="flex items-center gap-1 hover:text-brand transition"
                        title="Click to copy phone number"
                      >
                        <Phone size={11} className="text-slate-400" />
                        <span>{activeConversation.phone}</span>
                        <Copy size={10} className="opacity-40" />
                      </button>
                      <span>&bull;</span>
                      <span className="flex items-center gap-1 font-semibold text-emerald-700">
                        <Sparkles size={11} className="text-emerald-500" />
                        <span>{formatStep(displayWorkflowStep)}</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: AI / Human Switch & Context Panel Toggle */}
                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                  {/* AI / Human Takeover Switch */}
                  <div className="flex items-center rounded-xl border border-slate-200 bg-slate-100 p-1 shadow-inner">
                    {(["agent", "human"] as ConversationMode[]).map((mode) => {
                      const isActive = activeConversation.mode === mode;
                      const isTargetLoading = modeSaving && !isActive;

                      return (
                        <button
                          key={mode}
                          data-testid={`mode-toggle-${mode}`}
                          onClick={() => void handleModeChange(mode)}
                          disabled={modeSaving}
                          className={clsx(
                            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all duration-200",
                            isActive
                              ? "bg-white text-slate-900 shadow-sm"
                              : "text-slate-500 hover:text-slate-800"
                          )}
                        >
                          {isTargetLoading ? (
                            <Loader2 size={13} className="animate-spin text-brand" />
                          ) : mode === "agent" ? (
                            <Bot size={13} className={isActive ? "text-emerald-600" : "text-slate-400"} />
                          ) : (
                            <UserRound size={13} className={isActive ? "text-amber-600" : "text-slate-400"} />
                          )}
                          <span className="hidden sm:inline">{mode === "agent" ? "AI Bot" : "Human"}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Context & Live Draft Panel Toggle Button */}
                  <button
                    onClick={toggleContextPanelOpen}
                    title={isContextPanelOpen ? "Minimize context panel" : "Expand context & cart panel"}
                    className={clsx(
                      "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition shadow-sm",
                      isContextPanelOpen
                        ? "border-brand/40 bg-brand/10 text-brand"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    )}
                  >
                    <ShoppingCart size={14} className={isContextPanelOpen ? "text-brand" : "text-slate-500"} />
                    <span className="hidden sm:inline">Draft ({displayDraftItemCount})</span>
                    {isContextPanelOpen ? (
                      <PanelRightClose size={14} className="hidden sm:inline ml-0.5" />
                    ) : (
                      <PanelRightOpen size={14} className="hidden sm:inline ml-0.5" />
                    )}
                  </button>
                </div>
              </div>
            </header>

            {/* Messages Viewport */}
            <div
              ref={messagesViewportRef}
              className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 overscroll-contain bg-slate-50/40"
            >
              {hasMoreMessages && (
                <div className="mb-6 flex justify-center">
                  <button
                    onClick={() => selectedId && oldestLoadedIngestSeq != null && void loadMessages(selectedId, oldestLoadedIngestSeq)}
                    disabled={loadingOlder || oldestLoadedIngestSeq == null}
                    className="rounded-full bg-white border border-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                  >
                    {loadingOlder ? "Loading older history..." : "Load earlier messages"}
                  </button>
                </div>
              )}

              {loadingMessages && displayMessages.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 size={24} className="animate-spin text-brand" />
                </div>
              ) : (
                <div className="mx-auto max-w-3xl space-y-5">
                  {displayMessages.map((message, index) => {
                    const currentDate = new Date(message.created_at);
                    const previousDate = index > 0 ? new Date(displayMessages[index - 1].created_at) : null;
                    const showDayDivider = !previousDate || !isSameDay(currentDate, previousDate);
                    const isIncoming = message.sender_kind === "user";
                    const isSystem = message.sender_kind === "system";
                    const isHuman = message.sender_kind === "human";

                    return (
                      <div key={message.id} data-testid="message-bubble">
                        {showDayDivider && (
                          <div className="mb-6 mt-3 flex items-center justify-center">
                            <span className="rounded-full border border-slate-200 bg-white px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 shadow-sm">
                              {formatMessageDay(message.created_at)}
                            </span>
                          </div>
                        )}

                        {isSystem ? (
                          <div className="flex justify-center my-2">
                            <div className="max-w-md rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-900 shadow-sm">
                              {renderMessageContent(message.content)}
                            </div>
                          </div>
                        ) : (
                          <div className={clsx("flex", isIncoming ? "justify-start" : "justify-end")}>
                            <div
                              className={clsx(
                                "relative max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm sm:max-w-[78%] sm:px-5 sm:py-3.5",
                                isIncoming
                                  ? "rounded-tl-xs border border-slate-200 bg-white text-slate-800"
                                  : isHuman
                                    ? "rounded-tr-xs bg-brand text-white"
                                    : "rounded-tr-xs bg-slate-900 text-white"
                              )}
                            >
                              {/* Header Label */}
                              <div
                                className={clsx(
                                  "mb-1 flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-wider",
                                  isIncoming ? "text-slate-400" : "text-white/60"
                                )}
                              >
                                <span className="flex items-center gap-1.5">
                                  {isIncoming ? (
                                    message.isVoiceNote ? <Mic size={12} className="text-emerald-500" /> : <User size={11} />
                                  ) : isHuman ? (
                                    <Users size={11} />
                                  ) : (
                                    <Bot size={11} />
                                  )}
                                  <span>
                                    {isIncoming ? (activeConversation.name || "Customer") : isHuman ? "Staff Operator" : "AI Agent"}
                                  </span>
                                  {isIncoming && message.isVoiceNote && (
                                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
                                      Voice
                                    </span>
                                  )}
                                </span>
                                <span className="font-medium normal-case tracking-normal opacity-80">
                                  {format(currentDate, "h:mm a")}
                                </span>
                              </div>

                              {/* Voice Note Audio Player — strictly for incoming customer voice notes */}
                              {isIncoming && (message.isVoiceNote || message.audioUrl) && (
                                <div className="my-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-2.5 sm:p-3 text-slate-800 transition-colors">
                                  <div className="mb-2 flex items-center gap-2">
                                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white shadow-xs shrink-0">
                                      <Mic size={13} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs font-bold leading-none text-emerald-950">
                                        WhatsApp Voice Note
                                      </p>
                                      <p className="text-[10px] mt-0.5 truncate text-emerald-700">
                                        {message.audioUrl ? "Audio message" : "Recorded audio"}
                                      </p>
                                    </div>
                                  </div>

                                  {message.audioUrl ? (
                                    <div className="mt-1">
                                      <audio
                                        controls
                                        src={message.audioUrl}
                                        preload="metadata"
                                        className="h-8 w-full max-w-[280px] sm:max-w-[320px] rounded-md outline-none"
                                      />
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5 text-[11px] italic opacity-75 text-emerald-800/80">
                                      <Volume2 size={12} />
                                      <span>Audio recording expired or hosted on WhatsApp</span>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Content */}
                              {message.content && (
                                isIncoming && message.isVoiceNote ? (
                                  <div className="mt-1 rounded-xl border border-emerald-200 bg-emerald-50/40 p-2.5 text-xs sm:text-sm text-slate-800">
                                    <div className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                                      <Sparkles size={11} />
                                      <span>Transcription</span>
                                    </div>
                                    <div className="whitespace-pre-wrap leading-relaxed font-medium">
                                      {message.transcript ? (
                                        renderMessageContent(message.transcript)
                                      ) : message.content && !message.content.includes("[Voice note") ? (
                                        renderMessageContent(message.content.replace(/^🎤\s*(\[Voice note transcribed\]:\s*)?/i, "").replace(/^"|"$/g, "").trim())
                                      ) : (
                                        <span className="italic text-slate-400">Audio received (no transcript available)</span>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="whitespace-pre-wrap">{renderMessageContent(message.content)}</div>
                                )
                              )}

                              {/* Interactive WhatsApp Reply Buttons */}
                              {message.replyButtons && message.replyButtons.length > 0 && (
                                <div className={clsx("mt-3 border-t pt-2.5", isIncoming ? "border-slate-200" : "border-white/15")}>
                                  <div
                                    className={clsx(
                                      "mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider",
                                      isIncoming ? "text-slate-400" : "text-white/60"
                                    )}
                                  >
                                    <Sparkles size={10} />
                                    <span>WhatsApp Interactive Buttons</span>
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {message.replyButtons.map((btn) => (
                                      <div
                                        key={btn.id}
                                        className={clsx(
                                          "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-xs transition-all",
                                          isIncoming
                                            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                                            : "border-emerald-400/30 bg-emerald-500/20 text-emerald-200"
                                        )}
                                      >
                                        <span className="text-[10px]">🔘</span>
                                        <span>{btn.title}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Interactive WhatsApp List Selector */}
                              {message.listSelector && (
                                <div
                                  className={clsx(
                                    "mt-3 overflow-hidden rounded-xl border p-3",
                                    isIncoming
                                      ? "border-slate-200 bg-slate-50 text-slate-800"
                                      : "border-white/15 bg-black/40 text-white"
                                  )}
                                >
                                  <div className="mb-2 flex items-center justify-between text-xs font-bold">
                                    <span className={clsx("flex items-center gap-1.5", isIncoming ? "text-emerald-700" : "text-emerald-300")}>
                                      <Package size={13} />
                                      <span>{message.listSelector.title}</span>
                                    </span>
                                    <span
                                      className={clsx(
                                        "rounded px-2 py-0.5 text-[9px] font-bold uppercase",
                                        isIncoming
                                          ? "border border-emerald-200 bg-emerald-100 text-emerald-800"
                                          : "bg-emerald-500/30 text-emerald-200"
                                      )}
                                    >
                                      {message.listSelector.buttonText || "Interactive List"}
                                    </span>
                                  </div>
                                  <div className="space-y-1.5">
                                    {message.listSelector.rows.map((row) => (
                                      <div
                                        key={row.id}
                                        className={clsx(
                                          "flex items-center justify-between rounded-lg border p-2 text-xs",
                                          isIncoming ? "border-slate-200 bg-white" : "border-white/10 bg-white/5"
                                        )}
                                      >
                                        <div>
                                          <p className={clsx("font-semibold", isIncoming ? "text-slate-800" : "text-white")}>{row.title}</p>
                                          {row.description && (
                                            <p className={clsx("text-[11px]", isIncoming ? "text-slate-500" : "text-slate-300")}>
                                              {row.description}
                                            </p>
                                          )}
                                        </div>
                                        <span
                                          className={clsx(
                                            "rounded px-2 py-0.5 text-[10px] font-bold border",
                                            isIncoming
                                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                              : "border-emerald-500/30 bg-emerald-500/20 text-emerald-300"
                                          )}
                                        >
                                          Select
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Delivery Status Indicator */}
                              {!isIncoming && message.delivery_status && (
                                <div className="mt-1.5 flex items-center justify-end gap-1 text-[10px] opacity-75">
                                  {message.delivery_status === "read" ? (
                                    <CheckCheck size={12} className="text-blue-300" />
                                  ) : message.delivery_status === "delivered" ? (
                                    <CheckCheck size={12} />
                                  ) : (
                                    <Check size={12} />
                                  )}
                                  <span className="capitalize">{message.delivery_status}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Typing Indicator */}
                  {demoState?.isTyping && (
                    <div data-testid="typing-indicator" className="flex justify-start my-2">
                      <div className="flex items-center gap-2 rounded-2xl rounded-tl-xs border border-slate-200 bg-white px-4 py-3 text-slate-500 shadow-sm">
                        <Bot size={14} className="text-emerald-500 animate-pulse" />
                        <span className="text-xs font-semibold text-slate-500">AI Agent is typing</span>
                        <div className="flex items-center gap-1">
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "0ms" }} />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "150ms" }} />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={endRef} className="h-2" />
                </div>
              )}
            </div>

            {/* Bottom Floating Composer & Takeover Controls */}
            <div className="flex-shrink-0 border-t border-slate-200 bg-white p-3 sm:p-4">
              <div className="mx-auto max-w-3xl space-y-3">
                {activeConversation.mode === "agent" ? (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3.5 shadow-sm">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-sm">
                        <Bot size={16} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-emerald-950">AI Agent Active</p>
                        <p className="text-[11px] text-emerald-700">The assistant is actively responding to this customer automatically.</p>
                      </div>
                    </div>
                    <button
                      onClick={() => void handleModeChange("human")}
                      disabled={modeSaving}
                      className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
                    >
                      {modeSaving ? <Loader2 size={13} className="animate-spin" /> : <UserCheck size={13} />}
                      Take Over to Reply
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Canned Quick Replies */}
                    <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
                      {CANNED_RESPONSES.slice(0, 4).map((reply, i) => (
                        <button
                          key={i}
                          onClick={() => setComposer(reply)}
                          className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 transition hover:border-brand/40 hover:bg-white"
                        >
                          {reply.slice(0, 32)}...
                        </button>
                      ))}
                    </div>

                    {/* Composer Input Box */}
                    <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/10 transition">
                      <textarea
                        value={composer}
                        onChange={(event) => setComposer(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            void handleSend();
                          }
                        }}
                        rows={2}
                        placeholder="Type a manual WhatsApp message... (Press Enter to send, Shift+Enter for new line)"
                        className="w-full resize-none bg-transparent px-4 py-3 text-sm outline-none placeholder:text-slate-400 font-sans"
                      />

                      <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => void handleModeChange("agent")}
                            disabled={modeSaving}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                            title="Release control back to AI agent"
                          >
                            <Bot size={13} className="text-emerald-600" />
                            <span>Return to AI</span>
                          </button>
                          <span className="text-[11px] text-slate-400 hidden sm:inline">Manual Mode Active</span>
                        </div>

                        <button
                          onClick={() => void handleSend()}
                          disabled={sending || !composer.trim()}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-brand-hover disabled:opacity-50"
                        >
                          {sending ? <Loader2 size={13} className="animate-spin" /> : <SendHorizonal size={13} />}
                          <span>Send Message</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {/* ─────────────────────────────────────────────────────────────
          PANE 3: DOCKABLE CONTEXT & LIVE CART PANEL (Right)
         ───────────────────────────────────────────────────────────── */}
      {isContextPanelOpen && activeConversation && (
        <aside className="hidden lg:flex w-80 xl:w-[340px] shrink-0 flex-col border-l border-slate-200 bg-white shadow-sm overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5">
            <div className="flex items-center gap-2">
              <ShoppingCart size={16} className="text-brand" />
              <h3 className="font-bold text-slate-900 text-sm">Customer & Order Context</h3>
            </div>
            <button
              onClick={toggleContextPanelOpen}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              title="Minimize panel"
            >
              <X size={16} />
            </button>
          </div>

          <div data-testid="draft-panel" className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* 1. Customer Intelligence Card */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Customer Profile</p>
                  <p className="font-bold text-slate-900 text-sm">{getConversationLabel(activeConversation)}</p>
                </div>
                <div className="text-right">
                  <span className="rounded-full bg-white border border-slate-200 px-2 py-0.5 text-xs font-bold text-slate-800">
                    {activeContact?.total_orders ?? 0} orders
                  </span>
                </div>
              </div>

              {/* Language Switcher */}
              <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200/60">
                <span className="font-medium text-slate-500">Language:</span>
                <span className="font-bold text-slate-800 capitalize">
                  {activeContact?.preferred_language?.replace("_", " ") || "English"}
                </span>
              </div>

              {/* Tags Editor */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Tags</label>
                <input
                  value={customerTags}
                  onChange={(event) => setCustomerTags(event.target.value)}
                  placeholder="e.g. VIP, frequent, spicy"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-brand/40"
                />
              </div>

              {/* Staff Notes */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Staff Notes</label>
                <textarea
                  value={customerNotes}
                  onChange={(event) => setCustomerNotes(event.target.value)}
                  rows={2}
                  placeholder="Preferences, allergy, delivery instructions..."
                  className="w-full resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-brand/40"
                />
              </div>

              <button
                onClick={() => void handleCustomerProfileSave()}
                disabled={savingCustomerProfile}
                className="w-full rounded-lg bg-slate-900 py-1.5 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {savingCustomerProfile ? "Saving..." : "Save Profile Details"}
              </button>
            </div>

            {/* 2. Live Cart & Order Draft */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Live Order Draft</p>
                <span className="rounded-full bg-brand/10 text-brand px-2 py-0.5 text-[10px] font-bold uppercase">
                  {formatStep(displayWorkflowStep)}
                </span>
              </div>

              {/* Order Delivery / Pickup Details */}
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Order Type:</span>
                  <span className="font-bold text-slate-900 capitalize">
                    {(isDemoContact && demoState?.orderType) ? demoState.orderType : (activeState?.order_type?.replace("-", " ") ?? "Not selected")}
                  </span>
                </div>

                {((isDemoContact && demoState?.address) || activeState?.address) && (
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500 shrink-0">Address:</span>
                    <span className="font-semibold text-slate-900 text-right truncate">
                      {(isDemoContact && demoState?.address) || activeState?.address}
                    </span>
                  </div>
                )}
              </div>

              {/* Draft Items List */}
              <div className="pt-2 border-t border-slate-200/60">
                <p className="text-[11px] font-bold text-slate-600 mb-2">Cart Items ({displayDraftItemCount})</p>
                {displayDraftLines.length === 0 ? (
                  <div className="py-6 text-center text-slate-400">
                    <Package size={24} className="mx-auto mb-1 opacity-25" />
                    <p className="text-xs font-medium">Cart is currently empty</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {displayDraftLines.map((line: DraftLine, i: number) => (
                      <div
                        key={i}
                        className="flex items-start justify-between rounded-lg border border-slate-200 bg-white p-2 text-xs"
                      >
                        <div>
                          <p className="font-bold text-slate-900">{line.name}</p>
                          {line.size && <p className="text-[10px] text-slate-500">Size: {line.size}</p>}
                          {line.addons && line.addons.length > 0 && (
                            <p className="text-[10px] text-slate-500">Add-ons: {line.addons.join(", ")}</p>
                          )}
                        </div>
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700 border border-slate-200">
                          x{line.qty}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 3. AI Turn & Sentiment Observability */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-2 text-xs">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Agent Observability</p>
              <div className="flex justify-between">
                <span className="text-slate-500">Bot Active:</span>
                <span className={clsx("font-bold", activeSession?.is_bot_active ? "text-emerald-600" : "text-amber-600")}>
                  {activeSession?.is_bot_active ? "Yes (Running)" : "No (Paused)"}
                </span>
              </div>
              {activeState?.last_intent && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Last Intent:</span>
                  <span className="font-semibold text-slate-900">{activeState.last_intent}</span>
                </div>
              )}
              {activeSession?.escalation_reason && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800 text-[11px] font-medium">
                  Escalated: {activeSession.escalation_reason}
                </div>
              )}
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
