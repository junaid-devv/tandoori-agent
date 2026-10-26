"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Script from "next/script";
import {
  Smartphone,
  RefreshCw,
  LogOut,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Info,
  Copy,
  Check,
  Send,
  Link2,
  QrCode,
} from "lucide-react";
import { clsx } from "clsx";
import { toast } from "sonner";
import { PageHeader } from "@/app/components/dashboard/PageHeader";
import { ErrorNotice } from "@/app/components/dashboard/WorkspaceUI";
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

type EvolutionSession = {
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
  activeProvider: "meta" | "evolution" | "none";
  whatsappEnabled: boolean;
  metaConfig: MetaConfig;
  evolution?: {
    interactiveMode?: "compatible" | "native";
    online: boolean;
    provider: "evolution" | "meta";
    instanceName: string | null;
    sessionId: string;
    session?: EvolutionSession | null;
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
  const { profile, session } = useDashboardContext();
  if (session.role === "branch_staff") return <p className="p-6 text-sm text-slate-600">Your restaurant administrator manages WhatsApp connections.</p>;
  // Discard pending QR codes and status state when the selected tenant changes.
  return <WhatsAppIntegration key={profile?.id || "loading"} />;
}

function WhatsAppIntegration() {
  const { profile } = useDashboardContext();
  const [data, setData] = useState<WaStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);

  // Active view tab in dashboard: "meta" vs "evolution"
  const [providerTab, setProviderTab] = useState<"meta" | "evolution">("meta");

  // Meta state
  const [testPhone, setTestPhone] = useState("");
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [metaPin, setMetaPin] = useState("");
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const sessionInfoRef = useRef<{ phoneNumberId?: string; wabaId?: string }>({});
  const isCompletingRef = useRef(false);

  // Evolution API state
  const [evolutionTab, setEvolutionTab] = useState<"qr" | "pair">("qr");
  const [pairPhone, setPairPhone] = useState("");
  const [generatedPairCode, setGeneratedPairCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [autoWebhookSuccess, setAutoWebhookSuccess] = useState(false);
  const [evolutionQr, setEvolutionQr] = useState<string | null>(null);

  const prevEvolutionStatusRef = useRef<string | null>(null);

  const fetchStatus = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true);
    try {
      const restParam = profile?.id ? `?restaurant_id=${encodeURIComponent(profile.id)}` : "";
      const res = await fetch(`/api/dashboard/whatsapp/status${restParam}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: WaStatusResponse = await res.json();
      setData(json);
      setStatusError(null);

      // Auto-set initial active tab based on active provider
      if (!isSilent && json.activeProvider === "evolution") {
        setProviderTab("evolution");
      }

      // Check Evolution API connection changes
      const currentEvolutionStatus = json.evolution?.session?.status;
      if (prevEvolutionStatusRef.current && prevEvolutionStatusRef.current !== "CONNECTED" && currentEvolutionStatus === "CONNECTED") {
        toast.success("Evolution API Connected Successfully! 🎉", {
          description: `Linked to ${json.evolution?.session?.me?.name || "your phone number"}.`,
        });
      }
      prevEvolutionStatusRef.current = currentEvolutionStatus || null;
      if (currentEvolutionStatus === "CONNECTED") setEvolutionQr(null);
    } catch {
      setStatusError("We couldn’t load the connection status. Refresh to try again.");
      if (!isSilent) {
        toast.error("Failed to load WhatsApp status");
      }
    } finally {
      if (!isSilent) setIsLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    fetchStatus(false);
  }, [fetchStatus]);

  // Poll status every 4 seconds when looking at Evolution API and scanning QR
  useEffect(() => {
    if (providerTab !== "evolution") return;

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
      if (!["https://www.facebook.com", "https://web.facebook.com", "https://business.facebook.com"].includes(event.origin)) return;
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

  const handleSwitchProvider = async (targetProvider: "meta" | "evolution") => {
    setIsActionLoading(true);
    try {
      const res = await fetch(`/api/dashboard/whatsapp/action${profile?.id ? `?restaurant_id=${encodeURIComponent(profile.id)}` : ""}`, {
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

  const handleEvolutionAction = async (
    action: "start" | "stop" | "restart" | "logout" | "pair" | "create_session" | "auto_webhook" | "interactive_mode",
    extra?: { phoneNumber?: string; interactiveMode?: "compatible" | "native" }
  ) => {
    setIsActionLoading(true);
    try {
      const res = await fetch(`/api/dashboard/whatsapp/action${profile?.id ? `?restaurant_id=${encodeURIComponent(profile.id)}` : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Action failed");
      if (typeof result.data?.qrBase64 === "string") {
        setEvolutionQr(result.data.qrBase64.startsWith("data:") ? result.data.qrBase64 : `data:image/png;base64,${result.data.qrBase64}`);
      }
      if (action === "logout" || action === "stop") setEvolutionQr(null);

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
      const res = await fetch(`/api/dashboard/whatsapp/action${profile?.id ? `?restaurant_id=${encodeURIComponent(profile.id)}` : ""}`, {
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
    sessionInfoRef.current = {};

    window.FB.login(
      async (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          setIsConnecting(false);
          toast.error("Connection cancelled or authorization code missing.");
          return;
        }

        if (isCompletingRef.current) return;
        isCompletingRef.current = true;
        // Meta's login callback and session-info message can arrive in either order.
        const deadline = Date.now() + 8_000;
        while ((!sessionInfoRef.current.phoneNumberId || !sessionInfoRef.current.wabaId) && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!sessionInfoRef.current.phoneNumberId || !sessionInfoRef.current.wabaId) {
          setIsConnecting(false);
          toast.error("Facebook did not return your selected account and phone. Please complete signup again.");
          return;
        }

        const payload: Record<string, string> = {
          code,
          ...(metaPin ? { pin: metaPin } : {}),
          restaurant_id: profile?.id || "",
        };
        if (sessionInfoRef.current.phoneNumberId) {
          payload.phone_number_id = sessionInfoRef.current.phoneNumberId;
        }
        if (sessionInfoRef.current.wabaId) {
          payload.waba_id = sessionInfoRef.current.wabaId;
        }

        fetch(`/api/dashboard/whatsapp/connect${profile?.id ? `?restaurant_id=${encodeURIComponent(profile.id)}` : ""}`, {
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
  const isEvolutionConnected = data?.evolution?.session?.status === "CONNECTED";
  const isActiveConnected = data?.activeProvider === "meta" ? isMetaConnected : data?.activeProvider === "evolution" ? isEvolutionConnected : false;
  const isEvolutionOnline = data?.evolution?.online ?? false;
  const qrBase64 = evolutionQr || data?.evolution?.qrBase64;
  const evolutionSession = data?.evolution?.session;


  return (
    <>
      <Script
        src="https://connect.facebook.net/en_US/sdk.js"
        strategy="afterInteractive"
        crossOrigin="anonymous"
      />

      <div className="space-y-6">
        <PageHeader title="WhatsApp" description="Connect your business number and keep customer conversations flowing." meta={<span className={clsx("status-pill", isLoading ? "bg-slate-100 text-slate-500" : isActiveConnected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>{isLoading ? "Checking status" : statusError ? "Status unavailable" : isActiveConnected ? "Connected" : "Not connected"}</span>} actions={<button onClick={() => void fetchStatus(false)} disabled={isLoading || isActionLoading} className="ui-button"><RefreshCw size={14} className={clsx(isLoading && "animate-spin")} />Refresh status</button>} />
        {statusError && <ErrorNotice message={statusError} retry={() => void fetchStatus(false)} />}
        <section className="ui-card overflow-hidden">
          <div className="border-b border-slate-100 p-5 sm:px-6"><h2 className="ui-section-title">Connection method</h2><p className="mt-1.5 text-xs text-slate-400">Choose a method to view setup and connection details.</p></div>
          <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">{[{key: "meta" as const, title: "WhatsApp Business Platform", subtitle: "Official Meta connection", icon: ShieldCheck}, {key: "evolution" as const, title: "Link a WhatsApp device", subtitle: "Scan a QR code or use a pairing code", icon: QrCode}].map(({key,title,subtitle,icon: Icon}) => <button key={key} type="button" aria-pressed={providerTab === key} onClick={() => setProviderTab(key)} className={clsx("flex items-center gap-3 rounded-xl border p-4 text-left transition", providerTab === key ? "border-orange-200 bg-orange-50/40 ring-1 ring-orange-100" : "border-slate-200 hover:bg-slate-50")}><span className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-white", providerTab === key ? "border-orange-200 text-brand" : "border-slate-200 text-slate-400")}><Icon size={19} /></span><div className="min-w-0"><p className="text-xs font-semibold text-slate-700">{title}</p><p className="mt-1 text-[11px] text-slate-400">{subtitle}</p></div>{data?.activeProvider === key && <span className="status-pill ml-auto hidden bg-emerald-50 text-emerald-700 sm:inline-flex">In use</span>}</button>)}</div>
          <div className="flex flex-col justify-between gap-3 border-t border-slate-100 bg-slate-50/40 px-6 py-4 sm:flex-row sm:items-center"><p className="max-w-xl text-xs leading-relaxed text-slate-500">{providerTab === "meta" ? "Connect through Facebook to use the official WhatsApp Business Platform." : "Connect a business number from WhatsApp’s Linked devices screen. Powered by Evolution."}</p>{data && data.activeProvider !== providerTab && <button disabled={isActionLoading || !!statusError} onClick={() => void handleSwitchProvider(providerTab)} className="ui-button shrink-0">{isActionLoading ? "Updating..." : "Use this method"}<Link2 size={14} /></button>}{data?.activeProvider === providerTab && <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-emerald-600"><Check size={14} />Current connection method</span>}</div>
        </section>

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
                      <h2 className="text-lg font-semibold text-slate-900">
                        {data?.metaConfig?.verifiedName || "Meta Cloud API Connection"}
                      </h2>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                        Coexistence
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {isMetaConnected ? "Your WhatsApp Business account is connected." : "Link a WhatsApp Business account to start receiving customer messages."}
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
              <div className="mt-4 space-y-1">
                <label htmlFor="meta-pin" className="text-xs font-semibold text-slate-700">Two-step verification PIN for a new Cloud API number</label>
                <input id="meta-pin" type="password" inputMode="numeric" maxLength={6} autoComplete="off" value={metaPin}
                  onChange={event => setMetaPin(event.target.value.replace(/\D/g, ""))}
                  className="block rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="6 digits (new numbers only)" />
                <p className="text-xs text-slate-500">Choose and save your PIN before connecting a new number. Existing Cloud API and coexistence connections do not need it here.</p>
              </div>
              <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-blue-50/80 p-3.5 text-xs text-blue-800">
                <Info className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" />
                <p>
                  <strong>Coexistence:</strong> When enabled through Meta signup, staff can keep using the WhatsApp Business App alongside the Cloud API. Availability depends on your Meta account and signup configuration.
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
        {/* VIEW 2: Evolution API (BAILEYS) SECTION */}
        {/* ========================================================================= */}
        {providerTab === "evolution" && (
          <div className="space-y-6">
            {/* Gateway Offline Warning */}
            {!isEvolutionOnline && !isLoading && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5">
                <div className="flex items-start gap-3.5">
                  <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-bold text-amber-900">Evolution connection needs setup</h3>
                    <p className="mt-1 text-xs text-amber-700 leading-relaxed">
                      {data?.evolution?.error || "The Evolution server is unavailable. Ask your administrator to check the connection settings."}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {isEvolutionConnected ? (
              /* CONNECTED STATE */
              <div className="rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50/50 to-white p-6 sm:p-8 shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-emerald-100">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md shadow-emerald-600/20">
                      <CheckCircle2 className="h-8 w-8" />
                    </div>
                    <div>
                      <h2 className="text-lg sm:text-xl font-bold text-slate-950">
                        {data?.activeProvider === "evolution" ? "Evolution is connected and active" : "Evolution is connected"}
                      </h2>
                      <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                        {data?.activeProvider === "evolution" ? "Your agent can receive and answer customer messages through this connection." : "Activate Evolution above to use this connection for customer messages."}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEvolutionAction("restart")}
                      disabled={isActionLoading}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={clsx("h-3.5 w-3.5", isActionLoading && "animate-spin")} />
                      Restart
                    </button>

                    <button
                      onClick={() => handleEvolutionAction("logout")}
                      disabled={isActionLoading}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 shadow-xs hover:bg-rose-100 transition-colors disabled:opacity-50"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Disconnect
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
                  <label htmlFor="interactive-mode" className="text-sm font-semibold text-slate-900">Menu and reply format</label>
                  <select id="interactive-mode" value={data?.evolution?.interactiveMode || "compatible"} disabled={isActionLoading}
                    onChange={event => handleEvolutionAction("interactive_mode", { interactiveMode: event.target.value as "compatible" | "native" })}
                    className="block w-full rounded-lg border border-slate-200 p-2 text-sm">
                    <option value="compatible">Compatible text options (recommended)</option>
                    <option value="native">Native lists and buttons (experimental)</option>
                  </select>
                  <p className="text-xs text-slate-600">Compatible mode sends numbered choices customers can answer by number or name. Native Evolution buttons may be invisible on some WhatsApp versions; test them before using with customers.</p>
                </div>
                {/* Account Details */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Connected Phone</span>
                    <p className="mt-1 text-base font-bold text-slate-900">
                      {evolutionSession?.me?.id ? `+${evolutionSession.me.id.split("@")[0].split(":")[0]}` : "Active Device"}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">WhatsApp Web Multi-Device</p>
                  </div>

                  <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Profile Name</span>
                    <p className="mt-1 text-base font-bold text-slate-900 truncate">
                      {evolutionSession?.me?.name || "Restaurant Agent"}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">Session: {evolutionSession?.sessionId || "default"}</p>
                  </div>

                  <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Connection</span>
                    <p className="mt-1 text-base font-bold text-slate-900">
                      Connected
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
                        Target: <code className="font-mono text-slate-700">/api/webhook/evolution</code>
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleEvolutionAction("auto_webhook")}
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
                      onClick={() => setEvolutionTab("qr")}
                      className={clsx(
                        "flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                        evolutionTab === "qr" ? "bg-white text-slate-950 shadow-xs" : "text-slate-600 hover:text-slate-900"
                      )}
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      Scan QR Code
                    </button>
                    <button
                      onClick={() => setEvolutionTab("pair")}
                      className={clsx(
                        "flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                        evolutionTab === "pair" ? "bg-white text-slate-950 shadow-xs" : "text-slate-600 hover:text-slate-900"
                      )}
                    >
                      <Smartphone className="h-3.5 w-3.5" />
                      Pairing Code
                    </button>
                  </div>
                </div>

                {evolutionTab === "qr" ? (
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
                              Scan this code. Click Start Session for a fresh code if it expires.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="w-56 h-56 sm:w-64 sm:h-64 flex flex-col items-center justify-center text-center p-4 bg-white rounded-2xl border border-dashed border-slate-300">
                          <QrCode className="h-12 w-12 text-slate-300 mb-2" />
                          <p className="text-xs font-semibold text-slate-700">QR Code Not Ready</p>
                          <p className="text-[11px] text-slate-400 mt-1">
                            {isEvolutionOnline
                              ? "Click 'Start Session' below to generate your QR code."
                              : "Configure your Evolution server, then click Start Session."}
                          </p>
                        </div>
                      )}

                      <div className="flex items-center gap-2 mt-4 w-full">
                        <button
                          onClick={() => handleEvolutionAction("start")}
                          disabled={isActionLoading}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
                        >
                          <RefreshCw className={clsx("h-3.5 w-3.5", isActionLoading && "animate-spin")} />
                          Start Session
                        </button>
                        <button
                          onClick={() => handleEvolutionAction("restart")}
                          disabled={isActionLoading || !isEvolutionOnline}
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
                      onClick={() => handleEvolutionAction("pair", { phoneNumber: pairPhone.replace(/[^0-9]/g, "") })}
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
                          <span className="text-2xl font-semibold font-mono tracking-widest text-slate-900 bg-white px-4 py-1.5 rounded-lg border border-slate-200">
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
