"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Script from "next/script";
import {
  Smartphone,
  RefreshCw,
  Power,
  LogOut,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Zap,
  Info,
  ExternalLink,
  Copy,
  Check,
  Send,
  MessageSquare,
  Sparkles,
  Link2,
  QrCode,
  Server,
  Radio,
} from "lucide-react";
import { clsx } from "clsx";
import { toast } from "sonner";
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";

type MetaConfig = {
  configured: boolean;
  status: string;
  phoneNumberId: string | null;
  wabaId: string | null;
  appId: string | null;
  configId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  verifyTokenSet: boolean;
  coexistenceEnabled: boolean;
};

type WaAkgSession = {
  id?: string;
  sessionId: string;
  status: string;
  qr?: string | null;
  uptime?: number;
  me?: {
    id?: string;
    name?: string;
  } | null;
  hasInstance?: boolean;
  pairingCode?: string | null;
  webhooks?: Array<{
    id: string;
    url: string;
    events: string[];
    isActive: boolean;
  }>;
};

type WaStatusResponse = {
  activeProvider: "meta" | "wa_akg" | "none";
  whatsappEnabled: boolean;
  metaConfig: MetaConfig;
  waAkg?: {
    online: boolean;
    provider: "wa_akg" | "meta";
    baseUrl: string;
    sessionId: string;
    session?: WaAkgSession | null;
    qrBase64?: string | null;
    error?: string | null;
  };
};

declare global {
  interface Window {
    fbAsyncInit?: () => void;
    FB?: {
      init: (options: Record<string, unknown>) => void;
      login: (
        callback: (response: { authResponse?: { code?: string } }) => void,
        options: Record<string, unknown>
      ) => void;
    };
  }
}

export default function WhatsAppPage() {
  const { profile } = useDashboardContext();
  const [data, setData] = useState<WaStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);

  // Active view tab in dashboard: "meta" vs "wa_akg"
  const [providerTab, setProviderTab] = useState<"meta" | "wa_akg">("meta");

  // Meta state
  const [testPhone, setTestPhone] = useState("");
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [showManualConnect, setShowManualConnect] = useState(false);
  const [manualWabaId, setManualWabaId] = useState("");
  const [manualPhoneId, setManualPhoneId] = useState("");
  const sessionInfoRef = useRef<{ phoneNumberId?: string; wabaId?: string }>({});
  const isCompletingRef = useRef(false);

  // WA-AKG state
  const [waAkgTab, setWaAkgTab] = useState<"qr" | "pair">("qr");
  const [pairPhone, setPairPhone] = useState("");
  const [generatedPairCode, setGeneratedPairCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [autoWebhookSuccess, setAutoWebhookSuccess] = useState(false);

  const prevAkgStatusRef = useRef<string | null>(null);

  const fetchStatus = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true);
    try {
      const restParam = profile?.id ? `?restaurant_id=${encodeURIComponent(profile.id)}` : "";
      const res = await fetch(`/api/dashboard/whatsapp/status${restParam}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: WaStatusResponse = await res.json();
      setData(json);

      // Auto-set initial active tab based on active provider
      if (!isSilent && json.activeProvider === "wa_akg") {
        setProviderTab("wa_akg");
      }

      // Check WA-AKG connection changes
      const currentAkgStatus = json.waAkg?.session?.status;
      if (prevAkgStatusRef.current && prevAkgStatusRef.current !== "CONNECTED" && currentAkgStatus === "CONNECTED") {
        toast.success("WA-AKG Connected Successfully! 🎉", {
          description: `Linked to ${json.waAkg?.session?.me?.name || "your phone number"}.`,
        });
      }
      prevAkgStatusRef.current = currentAkgStatus || null;
    } catch {
      if (!isSilent) {
        toast.error("Failed to connect to WhatsApp status API");
      }
    } finally {
      if (!isSilent) setIsLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    fetchStatus(false);
  }, [fetchStatus]);

  // Poll status every 4 seconds when looking at WA-AKG and scanning QR
  useEffect(() => {
    if (providerTab !== "wa_akg") return;

    const interval = setInterval(() => {
      fetchStatus(true);
    }, 4000);

    return () => clearInterval(interval);
  }, [providerTab, fetchStatus]);

  // Ensure FB SDK is initialized as soon as appId is available
  useEffect(() => {
    const appId = data?.metaConfig?.appId || process.env.NEXT_PUBLIC_META_APP_ID;
    window.fbAsyncInit = function () {
      if (window.FB && appId) {
        try {
          window.FB.init({
            appId,
            autoLogAppEvents: true,
            xfbml: true,
            version: "v22.0",
          });
        } catch (e) {
          console.warn("[FB.init] Init warning:", e);
        }
      }
    };
    if (window.FB && appId) {
      try {
        window.FB.init({
          appId,
          autoLogAppEvents: true,
          xfbml: true,
          version: "v22.0",
        });
      } catch (e) {
        console.warn("[FB.init] Immediate init warning:", e);
      }
    }
  }, [data?.metaConfig?.appId]);

  // Listen for Meta Embedded Signup message events
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!event.origin.includes("facebook.com")) return;
      try {
        const raw = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (raw.type === "WA_EMBEDDED_SIGNUP") {
          if (raw.event === "FINISH" || raw.event === "SUCCESS") {
            const { phone_number_id, waba_id } = raw.data || {};
            if (phone_number_id || waba_id) {
              sessionInfoRef.current = {
                phoneNumberId: phone_number_id,
                wabaId: waba_id,
              };
            }
          }
        }
      } catch {
        // Non-JSON message from other extensions/scripts
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // ---------------------------------------------------------------------------
  // Action Handlers
  // ---------------------------------------------------------------------------

  const handleSwitchProvider = async (targetProvider: "meta" | "wa_akg") => {
    setIsActionLoading(true);
    try {
      const res = await fetch("/api/dashboard/whatsapp/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "switch_provider", provider: targetProvider }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to switch provider");
      toast.success(result.message || `Switched to ${targetProvider.toUpperCase()}`);
      await fetchStatus(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleWaAkgAction = async (
    action: "start" | "stop" | "restart" | "logout" | "pair" | "create_session" | "auto_webhook",
    extra?: { phoneNumber?: string }
  ) => {
    setIsActionLoading(true);
    try {
      const res = await fetch("/api/dashboard/whatsapp/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Action failed");

      if (action === "auto_webhook") {
        setAutoWebhookSuccess(true);
        toast.success("Webhook Linked!", { description: result.message });
      } else if (action === "pair" && result.data?.pairingCode) {
        setGeneratedPairCode(result.data.pairingCode);
        toast.success("Pairing Code Generated!", { description: "Enter this code on your WhatsApp app." });
      } else {
        toast.success(result.message || `Action ${action} completed successfully`);
      }

      await fetchStatus(false);
    } catch (err) {
      toast.error((err as Error).message || "Action failed");
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleSendTestMessage = async () => {
    if (!testPhone.trim()) {
      toast.error("Please enter a phone number");
      return;
    }
    setIsSendingTest(true);
    try {
      const res = await fetch("/api/dashboard/whatsapp/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test_message",
          recipientPhone: testPhone.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to send test message");
      toast.success(json.message || "Test message sent successfully!");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSendingTest(false);
    }
  };

  // Meta Login
  const handleLaunchEmbeddedSignup = () => {
    if (!window.FB) {
      toast.error("Facebook SDK is still initializing. Please wait 2 seconds and try again.");
      return;
    }
    const configId = data?.metaConfig?.configId || process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID;
    if (!configId) {
      toast.error("Missing NEXT_PUBLIC_WHATSAPP_CONFIG_ID. Please set this in your environment.");
      return;
    }

    setIsConnecting(true);
    isCompletingRef.current = false;

    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          setIsConnecting(false);
          toast.error("Connection cancelled or authorization code missing.");
          return;
        }

        const payload: Record<string, string> = {
          code,
          restaurant_id: profile?.id || "",
        };
        if (sessionInfoRef.current.phoneNumberId) {
          payload.phone_number_id = sessionInfoRef.current.phoneNumberId;
        }
        if (sessionInfoRef.current.wabaId) {
          payload.waba_id = sessionInfoRef.current.wabaId;
        }

        fetch("/api/dashboard/whatsapp/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
          .then((r) => r.json())
          .then((res) => {
            if (res.success) {
              toast.success("WhatsApp Connected Successfully! 🎉");
              fetchStatus(false);
            } else {
              toast.error(res.error || "Failed to connect WhatsApp account");
            }
          })
          .catch((e) => {
            toast.error(e.message || "Network error completing connection");
          })
          .finally(() => {
            setIsConnecting(false);
          });
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "",
          sessionInfoVersion: "3",
        },
      }
    );
  };

  const copyPairingCode = () => {
    if (!generatedPairCode) return;
    navigator.clipboard.writeText(generatedPairCode);
    setCopiedCode(true);
    toast.success("Pairing code copied to clipboard!");
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const copyWebhookUrl = () => {
    const url = typeof window !== "undefined" ? `${window.location.origin}/api/webhook` : "";
    navigator.clipboard.writeText(url);
    setCopiedWebhook(true);
    toast.success("Webhook URL copied to clipboard!");
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  const isMetaConnected = data?.metaConfig?.configured && data?.metaConfig?.status === "CONNECTED";
  const isAkgConnected = data?.waAkg?.session?.status === "CONNECTED";
  const isAkgStarting = data?.waAkg?.session?.status === "STARTING" || data?.waAkg?.session?.status === "CONNECTING";
  const isAkgOnline = data?.waAkg?.online ?? false;
  const qrBase64 = data?.waAkg?.qrBase64;
  const akgSession = data?.waAkg?.session;

  const formatUptime = (seconds?: number) => {
    if (!seconds) return "Just started";
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  };

  return (
    <>
      <Script
        src="https://connect.facebook.net/en_US/sdk.js"
        strategy="afterInteractive"
        crossOrigin="anonymous"
      />

      <div className="space-y-6">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              WhatsApp Integration
              <span
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  data?.whatsappEnabled
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-slate-100 text-slate-600 border border-slate-200"
                )}
              >
                <span
                  className={clsx(
                    "h-2 w-2 rounded-full",
                    data?.whatsappEnabled ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
                  )}
                />
                {data?.whatsappEnabled
                  ? `Live (${data.activeProvider === "wa_akg" ? "WA-AKG" : "Meta"})`
                  : "Not Connected"}
              </span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Choose your WhatsApp provider: official Meta Cloud API or direct WhatsApp Web (WA-AKG).
            </p>
          </div>

          <button
            onClick={() => fetchStatus(false)}
            disabled={isLoading || isActionLoading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors disabled:opacity-50 self-start sm:self-auto"
          >
            <RefreshCw className={clsx("h-3.5 w-3.5", (isLoading || isActionLoading) && "animate-spin")} />
            Refresh
          </button>
        </div>

        {/* Dual Provider Selection Tabs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Tab 1: Meta Cloud API */}
          <div
            onClick={() => setProviderTab("meta")}
            className={clsx(
              "relative cursor-pointer rounded-2xl border-2 p-5 transition-all shadow-xs",
              providerTab === "meta"
                ? "border-blue-600 bg-white ring-2 ring-blue-600/10 shadow-sm"
                : "border-slate-200 bg-slate-50/60 hover:bg-white"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700 font-black">
                  Meta
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">Meta WhatsApp Cloud API</h3>
                  <p className="text-xs text-slate-500">Official Cloud API • Embedded Signup • Coexistence</p>
                </div>
              </div>

              {data?.activeProvider === "meta" && (
                <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-bold text-blue-800">
                  Active
                </span>
              )}
            </div>

            <p className="mt-3 text-xs text-slate-600 leading-relaxed">
              Official WhatsApp Business Cloud integration with Facebook OAuth popup. Ideal for production restaurants.
            </p>

            {data?.activeProvider !== "meta" && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSwitchProvider("meta");
                  }}
                  disabled={isActionLoading}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  Set as Active Provider →
                </button>
              </div>
            )}
          </div>

          {/* Tab 2: WA-AKG Baileys Direct */}
          <div
            onClick={() => setProviderTab("wa_akg")}
            className={clsx(
              "relative cursor-pointer rounded-2xl border-2 p-5 transition-all shadow-xs",
              providerTab === "wa_akg"
                ? "border-emerald-600 bg-white ring-2 ring-emerald-600/10 shadow-sm"
                : "border-slate-200 bg-slate-50/60 hover:bg-white"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 font-black">
                  WA
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">Direct WhatsApp Web (WA-AKG)</h3>
                  <p className="text-xs text-slate-500">QR Code Scan • Zero Meta API Approval • Multi-Device</p>
                </div>
              </div>

              {data?.activeProvider === "wa_akg" && (
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                  Active
                </span>
              )}
            </div>

            <p className="mt-3 text-xs text-slate-600 leading-relaxed">
              Link any WhatsApp number instantly via QR code scan or 8-digit pairing code. No Meta verification needed.
            </p>

            {data?.activeProvider !== "wa_akg" && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSwitchProvider("wa_akg");
                  }}
                  disabled={isActionLoading}
                  className="text-xs font-semibold text-emerald-600 hover:text-emerald-700"
                >
                  Set as Active Provider →
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* VIEW 1: META CLOUD API SECTION */}
        {/* ========================================================================= */}
        {providerTab === "meta" && (
          <div className="space-y-6">
            {/* Meta Hero Card */}
            <div className="rounded-2xl border border-slate-200/90 bg-white p-6 sm:p-7 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md shadow-emerald-600/20">
                    <Smartphone className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-black text-slate-900">
                        {data?.metaConfig?.verifiedName || "Meta Cloud API Connection"}
                      </h2>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                        Coexistence
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Connected via official Meta WhatsApp Business Cloud API with real-time sync.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleLaunchEmbeddedSignup}
                    disabled={isConnecting}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 text-xs font-bold shadow-xs transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={clsx("h-3.5 w-3.5", isConnecting && "animate-spin")} />
                    {isMetaConnected ? "Reconnect Account" : "Connect with Facebook"}
                  </button>
                </div>
              </div>

              {/* Notice */}
              <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-blue-50/80 p-3.5 text-xs text-blue-800">
                <Info className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" />
                <p>
                  <strong>Coexistence:</strong> Your staff keep using WhatsApp Business App on mobile, while AI simultaneously handles customer orders on the Cloud API.
                </p>
              </div>

              {/* Connection Health Checklist */}
              <div className="mt-6">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                  Connection Health
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 flex items-center gap-3">
                    <CheckCircle2 className={clsx("h-5 w-5", isMetaConnected ? "text-emerald-600" : "text-slate-300")} />
                    <div>
                      <p className="text-xs font-bold text-slate-800">Phone Registered</p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {data?.metaConfig?.phoneNumberId ? `ID: ${data.metaConfig.phoneNumberId.slice(0, 8)}...` : "Not linked"}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 flex items-center gap-3">
                    <CheckCircle2 className={clsx("h-5 w-5", isMetaConnected ? "text-emerald-600" : "text-slate-300")} />
                    <div>
                      <p className="text-xs font-bold text-slate-800">Webhook Active</p>
                      <p className="text-[11px] text-slate-500">Meta → your webhook</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 flex items-center gap-3">
                    <CheckCircle2 className={clsx("h-5 w-5", isMetaConnected ? "text-emerald-600" : "text-slate-300")} />
                    <div>
                      <p className="text-xs font-bold text-slate-800">Coexistence</p>
                      <p className="text-[11px] text-slate-500">Phone + AI together</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 flex items-center gap-3">
                    <CheckCircle2 className={clsx("h-5 w-5", data?.metaConfig?.verifyTokenSet ? "text-emerald-600" : "text-slate-300")} />
                    <div>
                      <p className="text-xs font-bold text-slate-800">Verify Token</p>
                      <p className="text-[11px] text-slate-500">
                        {data?.metaConfig?.verifyTokenSet ? "Token set" : "Missing token"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Live Test & Credentials */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Credentials Summary */}
              <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-4">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-slate-600" />
                  Meta Cloud API Credentials
                </h3>

                <div className="space-y-3">
                  <div className="flex justify-between items-center p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-xs font-medium text-slate-500">Connected Phone</span>
                    <span className="text-xs font-bold text-slate-900">
                      {data?.metaConfig?.displayPhoneNumber || "Not Connected"}
                    </span>
                  </div>

                  <div className="flex justify-between items-center p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-xs font-medium text-slate-500">Phone Number ID</span>
                    <span className="text-xs font-mono text-slate-700">
                      {data?.metaConfig?.phoneNumberId || "—"}
                    </span>
                  </div>

                  <div className="flex justify-between items-center p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-xs font-medium text-slate-500">WABA ID</span>
                    <span className="text-xs font-mono text-slate-700">
                      {data?.metaConfig?.wabaId || "—"}
                    </span>
                  </div>

                  <div className="flex justify-between items-center p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-xs font-medium text-slate-500">Webhook URL</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-slate-700 truncate max-w-[200px]">
                        /api/webhook
                      </span>
                      <button
                        onClick={copyWebhookUrl}
                        className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
                      >
                        {copiedWebhook ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Test Live Messaging */}
              <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-4">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Send className="h-4 w-4 text-slate-600" />
                  Test Live Messaging
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Send a live test message to your WhatsApp number to verify that outbound dispatch is working smoothly.
                </p>

                <div className="space-y-3 pt-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Recipient Phone Number (with Country Code)
                    </label>
                    <input
                      type="text"
                      placeholder="+923001234567"
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                    />
                  </div>

                  <button
                    onClick={handleSendTestMessage}
                    disabled={isSendingTest || !testPhone.trim()}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 text-xs font-bold shadow-xs transition-colors disabled:opacity-50"
                  >
                    <Send className={clsx("h-3.5 w-3.5", isSendingTest && "animate-spin")} />
                    {isSendingTest ? "Sending..." : "Send Test Message"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 2: WA-AKG (BAILEYS) SECTION */}
        {/* ========================================================================= */}
        {providerTab === "wa_akg" && (
          <div className="space-y-6">
            {/* Gateway Offline Warning */}
            {!isAkgOnline && !isLoading && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5">
                <div className="flex items-start gap-3.5">
                  <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-bold text-amber-900">WA-AKG Gateway Background Process Offline</h3>
                    <p className="mt-1 text-xs text-amber-700 leading-relaxed">
                      The local WhatsApp background engine is not currently running on port 3001. Start it via terminal in{" "}
                      <code className="bg-amber-100/80 px-1 py-0.5 rounded text-amber-900 font-mono">wa-akg</code> using{" "}
                      <code className="bg-amber-100/80 px-1 py-0.5 rounded text-amber-900 font-mono">npm run dev</code> or by running{" "}
                      <code className="bg-amber-100/80 px-1 py-0.5 rounded text-amber-900 font-mono">start-gateway.bat</code>.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {isAkgConnected ? (
              /* CONNECTED STATE */
              <div className="rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50/50 to-white p-6 sm:p-8 shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-emerald-100">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md shadow-emerald-600/20">
                      <CheckCircle2 className="h-8 w-8" />
                    </div>
                    <div>
                      <h2 className="text-lg sm:text-xl font-bold text-slate-950">
                        WA-AKG is Connected & Live!
                      </h2>
                      <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                        Your AI restaurant agent is actively receiving and responding to customer orders via WhatsApp Web.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleWaAkgAction("restart")}
                      disabled={isActionLoading}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={clsx("h-3.5 w-3.5", isActionLoading && "animate-spin")} />
                      Restart
                    </button>

                    <button
                      onClick={() => handleWaAkgAction("logout")}
                      disabled={isActionLoading}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 shadow-xs hover:bg-rose-100 transition-colors disabled:opacity-50"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Disconnect
                    </button>
                  </div>
                </div>

                {/* Account Details */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Connected Phone</span>
                    <p className="mt-1 text-base font-bold text-slate-900">
                      {akgSession?.me?.id ? `+${akgSession.me.id.split("@")[0].split(":")[0]}` : "Active Device"}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">WhatsApp Web Multi-Device</p>
                  </div>

                  <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Profile Name</span>
                    <p className="mt-1 text-base font-bold text-slate-900 truncate">
                      {akgSession?.me?.name || "Restaurant Agent"}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">Session: {akgSession?.sessionId || "default"}</p>
                  </div>

                  <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Gateway Uptime</span>
                    <p className="mt-1 text-base font-bold text-slate-900">
                      {formatUptime(akgSession?.uptime)}
                    </p>
                    <p className="text-xs text-emerald-600 font-medium mt-0.5">🟢 Online & Healthy</p>
                  </div>
                </div>

                {/* Auto Webhook Status */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                      <Link2 className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900">Inbound Webhook Routing</p>
                      <p className="text-[11px] text-slate-500">
                        Target: <code className="font-mono text-slate-700">/api/webhook/wa-akg</code>
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleWaAkgAction("auto_webhook")}
                    disabled={isActionLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors"
                  >
                    {autoWebhookSuccess ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {autoWebhookSuccess ? "Verified & Linked" : "Sync Webhook Link"}
                  </button>
                </div>
              </div>
            ) : (
              /* DISCONNECTED / SCAN QR STATE */
              <div className="rounded-2xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xs space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
                  <div>
                    <h2 className="text-lg sm:text-xl font-bold text-slate-950">
                      Connect via WhatsApp Web
                    </h2>
                    <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                      Scan the QR code with WhatsApp on your phone or use an 8-digit pairing code.
                    </p>
                  </div>

                  {/* Tab switchers: QR vs Pairing Code */}
                  <div className="flex items-center bg-slate-100 p-1 rounded-xl shrink-0">
                    <button
                      onClick={() => setWaAkgTab("qr")}
                      className={clsx(
                        "flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                        waAkgTab === "qr" ? "bg-white text-slate-950 shadow-xs" : "text-slate-600 hover:text-slate-900"
                      )}
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      Scan QR Code
                    </button>
                    <button
                      onClick={() => setWaAkgTab("pair")}
                      className={clsx(
                        "flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                        waAkgTab === "pair" ? "bg-white text-slate-950 shadow-xs" : "text-slate-600 hover:text-slate-900"
                      )}
                    >
                      <Smartphone className="h-3.5 w-3.5" />
                      Pairing Code
                    </button>
                  </div>
                </div>

                {waAkgTab === "qr" ? (
                  /* TAB 1: QR CODE */
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                    <div className="lg:col-span-5 flex flex-col items-center justify-center p-6 bg-slate-50/80 rounded-2xl border border-slate-200/80">
                      {qrBase64 ? (
                        <div className="relative p-3 bg-white rounded-2xl shadow-md border border-slate-100 group">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={qrBase64}
                            alt="WhatsApp QR Code"
                            className="w-56 h-56 sm:w-64 sm:h-64 rounded-xl object-contain"
                          />
                          <div className="mt-2 text-center">
                            <p className="text-[11px] font-semibold text-slate-500 animate-pulse">
                              Scanning active... code auto-refreshes
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="w-56 h-56 sm:w-64 sm:h-64 flex flex-col items-center justify-center text-center p-4 bg-white rounded-2xl border border-dashed border-slate-300">
                          <QrCode className="h-12 w-12 text-slate-300 mb-2" />
                          <p className="text-xs font-semibold text-slate-700">QR Code Not Ready</p>
                          <p className="text-[11px] text-slate-400 mt-1">
                            {isAkgOnline
                              ? "Click 'Start Session' below to generate your QR code."
                              : "Start the gateway server on port 3001."}
                          </p>
                        </div>
                      )}

                      <div className="flex items-center gap-2 mt-4 w-full">
                        <button
                          onClick={() => handleWaAkgAction("start")}
                          disabled={isActionLoading || !isAkgOnline}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
                        >
                          <RefreshCw className={clsx("h-3.5 w-3.5", isActionLoading && "animate-spin")} />
                          Start Session
                        </button>
                        <button
                          onClick={() => handleWaAkgAction("restart")}
                          disabled={isActionLoading || !isAkgOnline}
                          className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 shadow-xs transition-colors disabled:opacity-50"
                        >
                          Reset
                        </button>
                      </div>
                    </div>

                    {/* Step by Step Instructions */}
                    <div className="lg:col-span-7 space-y-4">
                      <h3 className="text-sm font-bold text-slate-900">How to Connect</h3>
                      <ol className="space-y-3 text-xs text-slate-600">
                        <li className="flex items-start gap-2.5">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
                            1
                          </span>
                          <span>Open <strong>WhatsApp</strong> or <strong>WhatsApp Business</strong> on your phone.</span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
                            2
                          </span>
                          <span>Tap <strong>Menu</strong> (Android 3 dots) or <strong>Settings</strong> (iPhone) → <strong>Linked Devices</strong>.</span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
                            3
                          </span>
                          <span>Tap <strong>Link a Device</strong> and point your phone at the QR code.</span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
                            4
                          </span>
                          <span>The page will automatically detect the connection and turn <strong className="text-emerald-600">Live</strong>!</span>
                        </li>
                      </ol>
                    </div>
                  </div>
                ) : (
                  /* TAB 2: PAIRING CODE */
                  <div className="max-w-md space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Phone Number with Country Code
                      </label>
                      <input
                        type="text"
                        placeholder="+923001234567"
                        value={pairPhone}
                        onChange={(e) => setPairPhone(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                      />
                    </div>

                    <button
                      onClick={() => handleWaAkgAction("pair", { phoneNumber: pairPhone.replace(/[^0-9]/g, "") })}
                      disabled={isActionLoading || !pairPhone.trim()}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 text-xs font-bold shadow-xs transition-colors disabled:opacity-50"
                    >
                      <Smartphone className="h-3.5 w-3.5" />
                      Generate 8-Digit Pairing Code
                    </button>

                    {generatedPairCode && (
                      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center space-y-2">
                        <p className="text-xs text-slate-500 font-medium">Enter this code on your WhatsApp app:</p>
                        <div className="flex items-center justify-center gap-2">
                          <span className="text-2xl font-black font-mono tracking-widest text-slate-900 bg-white px-4 py-1.5 rounded-lg border border-slate-200">
                            {generatedPairCode}
                          </span>
                          <button
                            onClick={copyPairingCode}
                            className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                          >
                            {copiedCode ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
