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
import { PageHeader } from "@/app/components/dashboard/PageHeader";

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
  const [data, setData] = useState<WaStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const fetchStatus = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true);
    try {
      const res = await fetch("/api/dashboard/whatsapp/status", { cache: "no-store" });
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
  }, []);

  useEffect(() => {
    fetchStatus(false);
  }, [fetchStatus]);

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
            toast.success("Embedded Signup completed on Meta! Finalizing connection...");

            // Notify backend to subscribe and persist
            if (phone_number_id && waba_id) {
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

  const completeEmbeddedSignup = async (params: {
    code?: string;
    phoneNumberId: string;
    wabaId: string;
  }) => {
    setIsConnecting(true);
    try {
      const res = await fetch("/api/dashboard/whatsapp/connect", {
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
      await fetchStatus(false);
    } catch (err) {
      toast.error((err as Error).message || "Connection failed.");
    } finally {
      setIsConnecting(false);
    }
  };

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

    if (!configId) {
      toast.error("WHATSAPP_CONFIG_ID is missing. Please configure it in your environment settings.");
      return;
    }

    setIsConnecting(true);

    window.FB.login(
      (response) => {
        if (response.authResponse?.code) {
          const authCode = response.authResponse.code;
          toast.success("Authorization granted! Connecting to ORDERiQ...");
          completeEmbeddedSignup({
            code: authCode,
            phoneNumberId: data?.metaConfig?.phoneNumberId || "",
            wabaId: data?.metaConfig?.wabaId || "",
          });
        } else {
          setIsConnecting(false);
          toast.info("Signup popup closed without authorization.");
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
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Facebook JS SDK Loader */}
      <Script
        src="https://connect.facebook.net/en_US/sdk.js"
        strategy="lazyOnload"
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

      <PageHeader
        title="WhatsApp Channel Integration"
        description="Official Meta WhatsApp Cloud API with Coexistence — keep your phone app while AI handles customer orders."
        actions={
          <button
            onClick={() => fetchStatus(false)}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-xs"
          >
            <RefreshCw size={14} className={clsx(isLoading && "animate-spin text-emerald-600")} />
            Refresh Status
          </button>
        }
      />

      {/* Primary Status Banner */}
      <div className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div
              className={clsx(
                "flex h-14 w-14 items-center justify-center rounded-2xl shadow-sm shrink-0",
                isConfigured
                  ? "bg-emerald-600 text-white shadow-emerald-500/20"
                  : "bg-amber-500 text-white shadow-amber-500/20"
              )}
            >
              <Smartphone size={28} />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                  {isConfigured
                    ? data?.metaConfig?.verifiedName || "WhatsApp Business Active"
                    : "Connect Restaurant WhatsApp"}
                </h2>
                <span
                  className={clsx(
                    "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold",
                    isConfigured
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-800"
                  )}
                >
                  <span
                    className={clsx(
                      "h-1.5 w-1.5 rounded-full",
                      isConfigured ? "bg-emerald-600" : "bg-amber-600"
                    )}
                  />
                  {isConfigured ? "Live & Connected" : "Action Required"}
                </span>
                {isConfigured && isCoexActive && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    <Sparkles size={12} className="text-blue-600" />
                    Coexistence Active
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-xs sm:text-sm text-slate-600 max-w-2xl leading-relaxed">
                {isConfigured
                  ? "Connected via official Meta WhatsApp Business Cloud API. Messages sent from your mobile WhatsApp Business app and customer chats automatically sync in real-time."
                  : "Connect your existing WhatsApp Business number in 60 seconds with Embedded Signup. You do NOT need a new SIM or to delete your phone app."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full lg:w-auto">
            {isConfigured ? (
              <button
                type="button"
                onClick={launchEmbeddedSignup}
                disabled={isConnecting}
                className="w-full lg:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-all shadow-xs"
              >
                <RefreshCw size={14} className={clsx(isConnecting && "animate-spin")} />
                Reconnect / Switch Number
              </button>
            ) : (
              <button
                type="button"
                onClick={launchEmbeddedSignup}
                disabled={isConnecting}
                className="w-full lg:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-all shadow-md shadow-emerald-600/25 active:scale-98"
              >
                {isConnecting ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <Zap size={16} />
                )}
                Connect WhatsApp with Meta
              </button>
            )}
          </div>
        </div>

        {/* Coexistence explanation alert */}
        <div className="mt-6 rounded-2xl bg-slate-50 border border-slate-200/70 p-4 flex items-start gap-3">
          <Info size={18} className="text-slate-500 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-600 leading-relaxed">
            <strong className="text-slate-800">What is Coexistence? </strong>
            Meta’s Coexistence feature allows your restaurant staff to keep using the official{" "}
            <strong>WhatsApp Business App on their mobile phone</strong> for manual customer replies,
            while <strong>ORDERiQ AI</strong> simultaneously answers orders and menus on the Cloud API.
            When you type a manual reply on your phone, ORDERiQ automatically recognizes it via{" "}
            <code className="text-slate-800 font-mono bg-white px-1 py-0.5 rounded border border-slate-200">
              smb_message_echoes
            </code>{" "}
            and pauses bot automation so you have full control.
          </div>
        </div>
      </div>

      {/* Integration Details & Testing Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Account Details & Webhooks */}
        <div className="lg:col-span-2 space-y-6">
          {/* Account Credentials */}
          <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck size={16} className="text-emerald-600" />
              Meta Cloud API Credentials
            </h3>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Connected Phone Number
                </span>
                <p className="mt-1 text-sm font-bold text-slate-800">
                  {data?.metaConfig?.displayPhoneNumber || "Not Connected"}
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Phone Number ID
                </span>
                <p className="mt-1 text-xs font-mono text-slate-700 truncate">
                  {data?.metaConfig?.phoneNumberId || "Pending Signup"}
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  WABA ID (Business Account)
                </span>
                <p className="mt-1 text-xs font-mono text-slate-700 truncate">
                  {data?.metaConfig?.wabaId || "Managed via Tech Provider"}
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Quality Rating
                </span>
                <p className="mt-1 text-xs font-semibold text-emerald-700">
                  {data?.metaConfig?.qualityRating || "GREEN / High"}
                </p>
              </div>
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
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <MessageSquare size={16} className="text-indigo-600" />
              Test Live Messaging
            </h3>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Verify your outbound Meta Cloud API connection by sending a real WhatsApp greeting.
            </p>

            <form onSubmit={handleSendTestMessage} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Recipient WhatsApp Number
                </label>
                <input
                  type="text"
                  placeholder="+923001234567"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Include country code (e.g. +92 or 92)
                </span>
              </div>

              <button
                type="submit"
                disabled={isSendingTest || !isConfigured}
                className={clsx(
                  "w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold text-white transition-all shadow-xs",
                  isConfigured
                    ? "bg-slate-900 hover:bg-slate-800"
                    : "bg-slate-300 cursor-not-allowed"
                )}
              >
                {isSendingTest ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
                Send Test WhatsApp
              </button>

              {!isConfigured && (
                <p className="text-[11px] text-amber-700 text-center">
                  Connect your WhatsApp account above before sending tests.
                </p>
              )}
            </form>
          </div>

          {/* Quick Help Card */}
          <div className="rounded-3xl border border-slate-200/80 bg-linear-to-br from-slate-900 to-slate-950 p-6 text-white shadow-sm">
            <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
              Tech Provider Mode
            </h4>
            <h3 className="mt-1 text-sm font-bold text-white">Zero Maintenance Onboarding</h3>
            <p className="mt-2 text-xs text-slate-300 leading-relaxed">
              When restaurants click &quot;Connect WhatsApp with Meta&quot;, Meta links their account to ORDERiQ seamlessly. No API keys or tokens need to be copied manually.
            </p>
            <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
              <span>Graph API: v22.0</span>
              <span className="text-emerald-400 font-semibold">Ready</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
