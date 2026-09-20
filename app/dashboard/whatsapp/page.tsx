"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  QrCode,
  Smartphone,
  RefreshCw,
  Power,
  LogOut,
  CheckCircle2,
  AlertCircle,
  Link2,
  Radio,
  Server,
  KeyRound,
  ShieldCheck,
  Zap,
  Info,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import { clsx } from "clsx";
import { toast } from "sonner";
import { PageHeader } from "@/app/components/dashboard/PageHeader";

type WaStatusResponse = {
  activeProvider: "wa_akg" | "meta";
  metaConfig: {
    configured: boolean;
    phoneNumberId: string | null;
    verifyTokenSet: boolean;
  };
  waAkg: {
    online: boolean;
    provider: "wa_akg" | "meta";
    baseUrl: string;
    sessionId: string;
    session?: {
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
    } | null;
    qrBase64?: string | null;
    error?: string | null;
  };
};

export default function WhatsAppPage() {
  const [data, setData] = useState<WaStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"qr" | "pair">("qr");
  const [pairPhone, setPairPhone] = useState("");
  const [generatedPairCode, setGeneratedPairCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [autoWebhookSuccess, setAutoWebhookSuccess] = useState(false);

  const prevStatusRef = useRef<string | null>(null);

  const fetchStatus = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true);
    try {
      const res = await fetch("/api/dashboard/whatsapp/status", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json: WaStatusResponse = await res.json();
      setData(json);

      const currentStatus = json.waAkg?.session?.status;
      if (prevStatusRef.current && prevStatusRef.current !== "CONNECTED" && currentStatus === "CONNECTED") {
        toast.success("WhatsApp Connected Successfully! 🎉", {
          description: `Linked to ${json.waAkg.session?.me?.name || "your phone number"}.`,
        });
      }
      prevStatusRef.current = currentStatus || null;
    } catch (err) {
      if (!isSilent) {
        toast.error("Failed to connect to WhatsApp status API");
      }
    } finally {
      if (!isSilent) setIsLoading(false);
    }
  }, []);

  // Poll status every 4 seconds when in QR scanning or starting state
  useEffect(() => {
    fetchStatus(false);

    const interval = setInterval(() => {
      fetchStatus(true);
    }, 4000);

    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleAction = async (
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
      if (!res.ok) {
        throw new Error(result.error || "Action failed");
      }

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

  const copyPairingCode = () => {
    if (!generatedPairCode) return;
    navigator.clipboard.writeText(generatedPairCode);
    setCopiedCode(true);
    toast.success("Pairing code copied to clipboard!");
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const session = data?.waAkg?.session;
  const isGatewayOnline = data?.waAkg?.online ?? false;
  const isConnected = session?.status === "CONNECTED";
  const isStarting = session?.status === "STARTING" || session?.status === "CONNECTING";
  const qrBase64 = data?.waAkg?.qrBase64;
  const rawStatus = session?.status || (isGatewayOnline ? "DISCONNECTED" : "OFFLINE");

  const formatUptime = (seconds?: number) => {
    if (!seconds) return "Just started";
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp Channel Integration"
        description="Connect and control your restaurant's WhatsApp bot directly from this dashboard."
        meta={
          <span
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide",
              isConnected
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : isStarting
                ? "bg-amber-50 text-amber-700 border border-amber-200"
                : "bg-slate-100 text-slate-700 border border-slate-200"
            )}
          >
            <span
              className={clsx(
                "h-2 w-2 rounded-full",
                isConnected
                  ? "bg-emerald-500 animate-pulse"
                  : isStarting
                  ? "bg-amber-500 animate-ping"
                  : "bg-slate-400"
              )}
            />
            {isConnected ? "Connected 🟢" : isStarting ? "Connecting ⏳" : rawStatus}
          </span>
        }
        actions={
          <button
            onClick={() => fetchStatus(false)}
            disabled={isLoading || isActionLoading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={clsx("h-3.5 w-3.5", (isLoading || isActionLoading) && "animate-spin")} />
            Refresh
          </button>
        }
      />

      {/* Gateway Offline Alert if Port 3001 is unreachable */}
      {!isGatewayOnline && !isLoading && (
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

      {/* Provider Selector Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* WA-AKG (Direct Web) */}
        <div className="relative rounded-2xl border-2 border-emerald-600 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 font-black">
                WA
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm sm:text-base">Direct WhatsApp Web (Baileys)</h3>
                <p className="text-xs text-slate-500">QR Code Scan • Zero Meta API Approval • Fast Local Setup</p>
              </div>
            </div>
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
              Active Provider
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-600 leading-relaxed">
            Runs seamlessly in the background. Link any existing WhatsApp or WhatsApp Business phone number simply by scanning the QR code below.
          </p>
        </div>

        {/* Official Meta API */}
        <div className="relative rounded-2xl border border-slate-200 bg-slate-50/60 p-5 shadow-xs opacity-80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700 font-black">
                Meta
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-sm sm:text-base">Meta WhatsApp Cloud API</h3>
                <p className="text-xs text-slate-500">Official Enterprise Meta Cloud Platform</p>
              </div>
            </div>
            <span className="text-[11px] font-semibold text-slate-400">
              {data?.metaConfig?.configured ? "Configured" : "Available"}
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-500 leading-relaxed">
            Requires Meta Developer App, permanent access token, and business phone number verification. Switch to this anytime via <code className="font-mono text-slate-700 font-semibold">WHATSAPP_PROVIDER=meta</code>.
          </p>
        </div>
      </div>

      {/* Main Connection Interface */}
      {isConnected ? (
        /* CONNECTED STATE */
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50/50 to-white p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-emerald-100">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md shadow-emerald-600/20">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-950">
                  WhatsApp is Connected & Live!
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                  Your AI restaurant agent is actively receiving and responding to customer orders.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleAction("restart")}
                disabled={isActionLoading}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={clsx("h-3.5 w-3.5", isActionLoading && "animate-spin")} />
                Restart Connection
              </button>

              <button
                onClick={() => handleAction("logout")}
                disabled={isActionLoading}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 shadow-xs hover:bg-rose-100 transition-colors disabled:opacity-50"
              >
                <LogOut className="h-3.5 w-3.5" />
                Disconnect
              </button>
            </div>
          </div>

          {/* Account Details Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Connected Phone</span>
              <p className="mt-1 text-base font-bold text-slate-900">
                {session?.me?.id ? `+${session.me.id.split("@")[0].split(":")[0]}` : "Active Device"}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">WhatsApp Web Multi-Device</p>
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Profile Name</span>
              <p className="mt-1 text-base font-bold text-slate-900 truncate">
                {session?.me?.name || "Restaurant Agent"}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">Session: {session?.sessionId || "default"}</p>
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Gateway Uptime</span>
              <p className="mt-1 text-base font-bold text-slate-900">
                {formatUptime(session?.uptime)}
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
                  Target: <code className="font-mono text-slate-700">http://localhost:3000/api/webhook/wa-akg</code>
                </p>
              </div>
            </div>

            <button
              onClick={() => handleAction("auto_webhook")}
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
                Connect Restaurant WhatsApp Number
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                Scan the QR code with WhatsApp on your phone or use a pairing code to link your number.
              </p>
            </div>

            {/* Tab switchers: QR vs Pairing Code */}
            <div className="flex items-center bg-slate-100 p-1 rounded-xl shrink-0">
              <button
                onClick={() => setActiveTab("qr")}
                className={clsx(
                  "flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                  activeTab === "qr" ? "bg-white text-slate-950 shadow-xs" : "text-slate-600 hover:text-slate-900"
                )}
              >
                <QrCode className="h-3.5 w-3.5" />
                Scan QR Code
              </button>
              <button
                onClick={() => setActiveTab("pair")}
                className={clsx(
                  "flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                  activeTab === "pair" ? "bg-white text-slate-950 shadow-xs" : "text-slate-600 hover:text-slate-900"
                )}
              >
                <Smartphone className="h-3.5 w-3.5" />
                Pairing Code
              </button>
            </div>
          </div>

          {activeTab === "qr" ? (
            /* TAB 1: QR CODE */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              {/* QR Code Container */}
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
                      {isGatewayOnline
                        ? "Click 'Start Session' below to generate your QR code."
                        : "Start the gateway server on port 3001."}
                    </p>
                    {isGatewayOnline && (
                      <button
                        onClick={() => handleAction("start")}
                        disabled={isActionLoading}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition-colors"
                      >
                        <Power className="h-3.5 w-3.5" />
                        Start Session
                      </button>
                    )}
                  </div>
                )}

                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={() => handleAction("restart")}
                    disabled={isActionLoading || !isGatewayOnline}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={clsx("h-3.5 w-3.5", isActionLoading && "animate-spin")} />
                    Regenerate QR
                  </button>

                  <button
                    onClick={() => handleAction("create_session")}
                    disabled={isActionLoading || !isGatewayOnline}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    <Zap className="h-3.5 w-3.5 text-amber-500" />
                    Init Session
                  </button>
                </div>
              </div>

              {/* Instructions */}
              <div className="lg:col-span-7 space-y-4">
                <h3 className="font-bold text-slate-900 text-base">How to link your phone:</h3>
                
                <ol className="space-y-3.5 text-xs sm:text-sm text-slate-600">
                  <li className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-800 text-xs">
                      1
                    </span>
                    <span>
                      Open <strong>WhatsApp</strong> on your mobile device (regular WhatsApp or WhatsApp Business).
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-800 text-xs">
                      2
                    </span>
                    <span>
                      Tap <strong>Settings</strong> (iOS) or <strong>Three dots ⋮</strong> (Android) $\rightarrow$ <strong>Linked Devices</strong>.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-800 text-xs">
                      3
                    </span>
                    <span>
                      Tap <strong>Link a Device</strong> and aim your phone camera at the QR code on this screen.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-800 text-xs">
                      4
                    </span>
                    <span>
                      The connection will activate automatically! All customer messages sent to your number will be answered instantly by your AI bot.
                    </span>
                  </li>
                </ol>

                <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3.5 text-xs text-blue-800 flex items-start gap-2.5">
                  <Info className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" />
                  <p>
                    <strong>Multi-Device Support:</strong> Linking uses WhatsApp's official multi-device capability. Your primary phone does not need to remain continuously connected to the internet once paired.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* TAB 2: PAIRING CODE */
            <div className="max-w-xl space-y-5">
              <div>
                <h3 className="font-bold text-slate-900 text-base">Pair with Phone Number:</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Don&apos;t have a camera or prefer a numeric code? Enter your WhatsApp phone number with country code.
                </p>
              </div>

              <div className="space-y-3">
                <label className="block text-xs font-bold text-slate-700">
                  Phone Number (with country code, no + or spaces):
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. 923001234567"
                    value={pairPhone}
                    onChange={(e) => setPairPhone(e.target.value.replace(/[^0-9]/g, ""))}
                    className="flex-1 rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                  />
                  <button
                    onClick={() => handleAction("pair", { phoneNumber: pairPhone })}
                    disabled={isActionLoading || !pairPhone || pairPhone.length < 10}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition-colors disabled:opacity-50"
                  >
                    Get Code
                  </button>
                </div>
              </div>

              {generatedPairCode && (
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 space-y-2">
                  <span className="text-xs font-bold text-emerald-900">Your WhatsApp Pairing Code:</span>
                  <div className="flex items-center justify-between bg-white rounded-lg p-3 border border-emerald-300">
                    <span className="font-mono text-xl font-black tracking-widest text-emerald-800">
                      {generatedPairCode}
                    </span>
                    <button
                      onClick={copyPairingCode}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-50 rounded"
                    >
                      {copiedCode ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copiedCode ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="text-[11px] text-emerald-700">
                    On your phone: WhatsApp $\rightarrow$ Linked Devices $\rightarrow$ Link a Device $\rightarrow$ <strong>Link with phone number instead</strong> $\rightarrow$ enter this code.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
