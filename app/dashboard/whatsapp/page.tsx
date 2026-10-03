"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Script from "next/script";
import {
  Smartphone,
  RefreshCw,
  Power,
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
} from "lucide-react";
import { clsx } from "clsx";
import { toast } from "sonner";
// PageHeader removed — replaced with inline compact header
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

type WaStatusResponse = {
  activeProvider: "meta";
  whatsappEnabled: boolean;
  metaConfig: MetaConfig;
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
  const [testPhone, setTestPhone] = useState("");
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const [showManualConnect, setShowManualConnect] = useState(false);
  const [manualWabaId, setManualWabaId] = useState("");
  const [manualPhoneId, setManualPhoneId] = useState("");
  const sessionInfoRef = useRef<{ phoneNumberId?: string; wabaId?: string }>({});
  const isCompletingRef = useRef(false);

  const fetchStatus = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true);
    try {
      const restParam = profile?.id ? `?restaurant_id=${encodeURIComponent(profile.id)}` : "";
      const res = await fetch(`/api/dashboard/whatsapp/status${restParam}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: WaStatusResponse = await res.json();
      setData(json);
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
        console.warn("[FB.init] Init warning:", e);
      }
    }
  }, [data?.metaConfig?.appId]);

  const completeEmbeddedSignup = async (params: {
    code?: string;
    phoneNumberId?: string;
    wabaId?: string;
  }) => {
    if (isCompletingRef.current) return;
    isCompletingRef.current = true;
    setIsConnecting(true);
    try {
      const restParam = profile?.id ? `?restaurant_id=${encodeURIComponent(profile.id)}` : "";
      const res = await fetch(`/api/dashboard/whatsapp/connect${restParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || "Failed to complete WhatsApp connection.");
      }

      toast.success("WhatsApp Connected Successfully! 🎉", {
        description: "Official Meta Cloud API and Coexistence are now active.",
      });
      setShowManualConnect(false);
      await fetchStatus(false);
    } catch (err) {
      toast.error((err as Error).message || "Connection failed.");
    } finally {
      setIsConnecting(false);
      isCompletingRef.current = false;
    }
  };

  // Handle Embedded Signup session finish events from Facebook popup
  useEffect(() => {
    const handleSessionMessage = async (event: MessageEvent) => {
      if (
        event.origin !== "https://www.facebook.com" &&
        event.origin !== "https://web.facebook.com"
      ) {
        return;
      }

      try {
        const payload = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (payload?.type === "WA_EMBEDDED_SIGNUP") {
          if (payload.event === "FINISH") {
            const { phone_number_id, waba_id } = payload.data || {};
            if (phone_number_id) sessionInfoRef.current.phoneNumberId = phone_number_id;
            if (waba_id) sessionInfoRef.current.wabaId = waba_id;

            toast.success("Embedded Signup completed on Meta! Finalizing connection...");

            // If phone_number_id and waba_id are present and not already completing with code:
            if (phone_number_id && waba_id && !isCompletingRef.current) {
              await completeEmbeddedSignup({
                phoneNumberId: phone_number_id,
                wabaId: waba_id,
              });
            }
          } else if (payload.event === "CANCEL") {
            toast.info("WhatsApp onboarding was cancelled.");
          }
        }
      } catch {
        // Non-JSON message from other extensions or frames
      }
    };

    window.addEventListener("message", handleSessionMessage);
    return () => window.removeEventListener("message", handleSessionMessage);
  }, []);

  const launchEmbeddedSignup = () => {
    const appId =
      data?.metaConfig?.appId ||
      process.env.NEXT_PUBLIC_META_APP_ID;
    const configId =
      data?.metaConfig?.configId ||
      process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID;

    if (!window.FB) {
      toast.error("Facebook SDK is still loading. Please try again in a few seconds.");
      return;
    }

    // Ensure FB is initialized before login
    if (appId) {
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

    setIsConnecting(true);

    // Timeout guard: reset button state if popup is blocked or closed silently
    const safetyTimeout = setTimeout(() => {
      setIsConnecting((prev) => {
        if (prev) {
          toast.info("If the Meta popup did not appear, please allow popups in your browser or connect manually below.");
          return false;
        }
        return false;
      });
    }, 15000);

    try {
      window.FB.login(
        function (response) {
          clearTimeout(safetyTimeout);
          if (response?.authResponse?.code) {
            const authCode = response.authResponse.code;
            toast.success("Authorization granted! Connecting to ORDERiQ...");
            void completeEmbeddedSignup({
              code: authCode,
              phoneNumberId: sessionInfoRef.current.phoneNumberId || "",
              wabaId: sessionInfoRef.current.wabaId || "",
            });
          } else {
            // If popup closed without authResponse code, check if message event already captured IDs
            if (sessionInfoRef.current.phoneNumberId && sessionInfoRef.current.wabaId && !isCompletingRef.current) {
              void completeEmbeddedSignup({
                phoneNumberId: sessionInfoRef.current.phoneNumberId,
                wabaId: sessionInfoRef.current.wabaId,
              });
            } else {
              setIsConnecting(false);
              toast.info("Signup popup closed.");
            }
          }
        },
        {
          config_id: configId,
          response_type: "code",
          override_default_response_type: true,
          extras: {
            setup: {},
            version: "v4",
            featureType: "whatsapp_business_app_onboarding",
            sessionInfoVersion: "3",
            coex: true,
          },
        }
      );
    } catch (err) {
      clearTimeout(safetyTimeout);
      setIsConnecting(false);
      toast.error("Could not launch signup: " + (err as Error).message);
    }
  };

  const handleManualConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualWabaId.trim() || !manualPhoneId.trim()) {
      toast.error("Please enter both WABA ID and Phone Number ID.");
      return;
    }
    await completeEmbeddedSignup({
      wabaId: manualWabaId.trim(),
      phoneNumberId: manualPhoneId.trim(),
    });
  };

  const handleSendTestMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPhone.trim()) {
      toast.error("Please enter a destination phone number.");
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

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to send test message");

      toast.success("Test Message Sent!", {
        description: result.message,
      });
      setTestPhone("");
    } catch (err) {
      toast.error((err as Error).message || "Failed to send test message");
    } finally {
      setIsSendingTest(false);
    }
  };

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/webhook`
      : "https://your-domain.com/api/webhook";

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    toast.success("Webhook URL copied to clipboard!");
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  const isConfigured = data?.metaConfig?.configured ?? false;
  const isCoexActive = data?.metaConfig?.coexistenceEnabled ?? true;

  return (
    <div className="space-y-3 max-w-6xl mx-auto pb-10">
      {/* Facebook JS SDK Loader */}
      <Script
        src="https://connect.facebook.net/en_US/sdk.js"
        strategy="afterInteractive"
        onLoad={() => {
          const appId = data?.metaConfig?.appId || process.env.NEXT_PUBLIC_META_APP_ID;
          if (window.FB && appId) {
            window.FB.init({
              appId,
              autoLogAppEvents: true,
              xfbml: true,
              version: "v22.0",
            });
          }
        }}
      />

      {/* Compact header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-bold text-slate-900">WhatsApp Integration</h1>
          <span
            className={clsx(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
              isConfigured ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
            )}
          >
            <span className={clsx("h-1.5 w-1.5 rounded-full", isConfigured ? "bg-emerald-500" : "bg-amber-500")} />
            {isConfigured ? "Live" : "Not Connected"}
          </span>
        </div>
        <button
          onClick={() => fetchStatus(false)}
          disabled={isLoading}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={13} className={clsx(isLoading && "animate-spin text-emerald-600")} />
          Refresh
        </button>
      </div>

      {/* Compact Status Banner */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={clsx(
                "flex h-10 w-10 items-center justify-center rounded-xl shadow-sm shrink-0",
                isConfigured
                  ? "bg-emerald-600 text-white"
                  : "bg-amber-500 text-white"
              )}
            >
              <Smartphone size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-slate-900">
                  {isConfigured
                    ? data?.metaConfig?.verifiedName || "WhatsApp Business Active"
                    : "Connect Restaurant WhatsApp"}
                </span>
                {isConfigured && isCoexActive && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">
                    <Sparkles size={10} className="text-blue-600" />
                    Coexistence
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                {isConfigured
                  ? "Connected via official Meta WhatsApp Business Cloud API with real-time sync."
                  : "Connect your existing WhatsApp Business number in 60 seconds. No new SIM needed."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isConfigured ? (
              <button
                type="button"
                onClick={launchEmbeddedSignup}
                disabled={isConnecting}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold transition-all"
              >
                <RefreshCw size={13} className={clsx(isConnecting && "animate-spin")} />
                Reconnect
              </button>
            ) : (
              <button
                type="button"
                onClick={launchEmbeddedSignup}
                disabled={isConnecting}
                className="inline-flex items-center gap-1.5 h-8 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all"
              >
                {isConnecting ? <RefreshCw size={13} className="animate-spin" /> : <Zap size={13} />}
                Connect with Meta
              </button>
            )}
          </div>
        </div>

        {/* Coexistence info — compact */}
        <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 flex items-start gap-2">
          <Info size={13} className="text-slate-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-slate-600 leading-relaxed">
            <strong className="text-slate-700">Coexistence: </strong>
            Your staff keep using WhatsApp Business App on mobile, while AI simultaneously handles customer orders on the Cloud API.
          </p>
        </div>

        {/* Connection Health Checklist */}
        {isConfigured && (
          <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 space-y-2">
            <p className="text-[11px] font-bold text-emerald-800 flex items-center gap-1">
              <CheckCircle2 size={12} className="text-emerald-600" />
              Connection Health
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                {
                  label: "Phone Registered",
                  ok: Boolean(data?.metaConfig?.phoneNumberId),
                  detail: data?.metaConfig?.phoneNumberId
                    ? `ID: ${data.metaConfig.phoneNumberId.slice(0, 8)}…`
                    : "Not found",
                },
                {
                  label: "Webhook Active",
                  ok: Boolean(data?.metaConfig?.phoneNumberId && data?.metaConfig?.configured),
                  detail: "Meta → your webhook",
                },
                {
                  label: "Coexistence",
                  ok: data?.metaConfig?.coexistenceEnabled ?? false,
                  detail: "Phone + AI together",
                },
                {
                  label: "Verify Token",
                  ok: data?.metaConfig?.verifyTokenSet ?? false,
                  detail: data?.metaConfig?.verifyTokenSet ? "Token set" : "Missing env var",
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className={clsx(
                    "flex items-start gap-1.5 p-2 rounded-lg border text-[11px]",
                    item.ok
                      ? "bg-white border-emerald-200 text-slate-700"
                      : "bg-amber-50 border-amber-200 text-amber-900"
                  )}
                >
                  {item.ok ? (
                    <CheckCircle2 size={11} className="text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle size={11} className="text-amber-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="font-semibold">{item.label}</p>
                    <p className={clsx("text-[10px]", item.ok ? "text-slate-400" : "text-amber-700")}>
                      {item.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Integration Details & Testing Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left Column: Account Details & Webhooks */}
        <div className="lg:col-span-2 space-y-4">
          {/* Account Credentials */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <ShieldCheck size={13} className="text-emerald-600" />
              Meta Cloud API Credentials
            </h3>

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Connected Phone
                </span>
                <p className="mt-0.5 text-sm font-bold text-slate-800">
                  {data?.metaConfig?.displayPhoneNumber || "Not Connected"}
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Phone Number ID
                </span>
                <p className="mt-0.5 text-xs font-mono text-slate-700 truncate">
                  {data?.metaConfig?.phoneNumberId || "Pending"}
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  WABA ID
                </span>
                <p className="mt-0.5 text-xs font-mono text-slate-700 truncate">
                  {data?.metaConfig?.wabaId || "Via Tech Provider"}
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Quality Rating
                </span>
                <p className="mt-0.5 text-xs font-semibold text-emerald-700">
                  {data?.metaConfig?.qualityRating || "GREEN / High"}
                </p>
              </div>
            </div>

            {/* Manual Credentials Fallback */}
            <div className="mt-5 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowManualConnect(!showManualConnect)}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5 transition-colors"
              >
                <span>{showManualConnect ? "− Hide Manual Setup" : "+ Already completed signup on Meta? Connect manually"}</span>
              </button>

              {showManualConnect && (
                <form onSubmit={handleManualConnect} className="mt-3 p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
                  <div className="text-xs text-slate-600 space-y-1.5">
                    <p>
                      If you finished signup in Meta or want to link your WhatsApp Business account directly:
                    </p>
                    <div className="text-[11px] text-slate-500 bg-white p-2.5 rounded-xl border border-slate-200">
                      <strong className="text-slate-700">Where to find these in Meta:</strong>
                      <ol className="list-decimal list-inside mt-1 space-y-0.5">
                        <li>Go to <strong>developers.facebook.com/apps/4417882651864292</strong> (or Meta Business Suite &rarr; WhatsApp Accounts).</li>
                        <li>Click <strong>WhatsApp</strong> &rarr; <strong>API Setup</strong>.</li>
                        <li>Copy the <strong>Phone number ID</strong> and <strong>WhatsApp Business Account ID (WABA ID)</strong>.</li>
                      </ol>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                        WABA ID (Business Account ID)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. 523910294819201"
                        value={manualWabaId}
                        onChange={(e) => setManualWabaId(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Phone Number ID
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. 102948572910394"
                        value={manualPhoneId}
                        onChange={(e) => setManualPhoneId(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={isConnecting}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all shadow-xs disabled:opacity-50"
                  >
                    {isConnecting ? <RefreshCw size={12} className="animate-spin" /> : <ShieldCheck size={14} />}
                    Save &amp; Link WhatsApp Credentials
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Webhook Configuration & Health */}
          <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Link2 size={16} className="text-blue-600" />
              Production Webhook Endpoints
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Meta forwards incoming customer messages, statuses, and phone app echoes to this URL.
            </p>

            <div className="mt-4 flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={webhookUrl}
                className="flex-1 px-3.5 py-2.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl text-slate-700 select-all"
              />
              <button
                type="button"
                onClick={copyWebhookUrl}
                className="flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-xs"
              >
                {copiedWebhook ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                {copiedWebhook ? "Copied" : "Copy"}
              </button>
            </div>

            {/* Subscribed Webhook Events */}
            <div className="mt-5 border-t border-slate-100 pt-4">
              <span className="text-xs font-bold text-slate-800">Subscribed Event Fields:</span>
              <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { name: "messages", desc: "Customer orders & chats" },
                  { name: "smb_message_echoes", desc: "Phone app replies" },
                  { name: "history", desc: "Past chat synchronization" },
                  { name: "smb_app_state_sync", desc: "Contact updates" },
                ].map((ev) => (
                  <div key={ev.name} className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                      <CheckCircle2 size={12} />
                      {ev.name}
                    </div>
                    <span className="text-[10px] text-slate-400 mt-0.5 block">{ev.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Live Test Message */}
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <MessageSquare size={13} className="text-indigo-600" />
              Test Live Messaging
            </h3>

            <form onSubmit={handleSendTestMessage} className="mt-3 space-y-3">
              <div>
                <label className="block text-[10px] font-medium uppercase tracking-wide text-slate-400 mb-1">
                  Recipient Number
                </label>
                <input
                  type="text"
                  placeholder="+923001234567"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  className="w-full h-8 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-400"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">Include country code (e.g. +92)</span>
              </div>

              <button
                type="submit"
                disabled={isSendingTest || !isConfigured}
                className={clsx(
                  "w-full flex items-center justify-center gap-1.5 h-8 px-4 rounded-lg text-xs font-bold text-white transition-all",
                  isConfigured
                    ? "bg-slate-900 hover:bg-slate-800"
                    : "bg-slate-300 cursor-not-allowed"
                )}
              >
                {isSendingTest ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
                Send Test
              </button>

              {!isConfigured && (
                <p className="text-[11px] text-amber-700 text-center">Connect WhatsApp above first.</p>
              )}
            </form>
          </div>

          {/* Tech Provider card */}
          <div className="rounded-xl bg-zinc-950 p-4 text-white shadow-sm">
            <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Tech Provider</p>
            <p className="mt-1 text-xs font-bold text-white">Zero Maintenance Onboarding</p>
            <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
              Restaurants click "Connect" and Meta links their account automatically. No manual API keys.
            </p>
            <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center justify-between text-[11px] text-slate-500">
              <span>Graph API: v22.0</span>
              <span className="text-emerald-400 font-semibold">Ready</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
