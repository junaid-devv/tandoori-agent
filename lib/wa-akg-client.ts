/**
 * WA-AKG Client Library for ORDERiQ
 * Communicates with the Baileys gateway service for session management,
 * live QR code acquisition, pairing codes, and webhook registration.
 */

export interface WaAkgSessionData {
  id?: string;
  sessionId: string;
  status: "CONNECTED" | "DISCONNECTED" | "STARTING" | "SCAN_QR_CODE" | "LOGGED_OUT" | string;
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
}

export interface WaAkgStatusResult {
  online: boolean;
  provider: "wa_akg" | "meta";
  baseUrl: string;
  sessionId: string;
  session?: WaAkgSessionData | null;
  qrBase64?: string | null;
  error?: string | null;
}

function getBaseUrl(): string {
  return (process.env.WA_AKG_BASE_URL || "http://localhost:3001").replace(/\/+$/, "");
}

function getApiKey(): string {
  return (process.env.WA_AKG_API_KEY || "").trim();
}

function getSessionId(): string {
  return (process.env.WA_AKG_SESSION_ID || "default").trim();
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const key = getApiKey();
  if (key) {
    headers["x-api-key"] = key;
  }
  return headers;
}

/**
 * Fetch complete WhatsApp Gateway status:
 * 1. Health check of port 3001
 * 2. Session details for the configured session ID
 * 3. Live base64 QR code if session is in scanning state
 */
export async function getWaAkgFullStatus(): Promise<WaAkgStatusResult> {
  const baseUrl = getBaseUrl();
  const sessionId = getSessionId();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    // 1. Fetch Session Details
    const sessionRes = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "GET",
      headers: getHeaders(),
      signal: controller.signal,
      cache: "no-store",
    }).finally(() => clearTimeout(timeout));

    if (!sessionRes.ok) {
      if (sessionRes.status === 404) {
        // Session does not exist yet in gateway DB
        return {
          online: true,
          provider: "wa_akg",
          baseUrl,
          sessionId,
          session: {
            sessionId,
            status: "DISCONNECTED",
            hasInstance: false,
          },
          error: "Session not initialized. Click 'Start Session' to generate a QR code.",
        };
      }

      const errData = await sessionRes.json().catch(() => ({}));
      return {
        online: true,
        provider: "wa_akg",
        baseUrl,
        sessionId,
        session: null,
        error: errData.message || `Gateway returned HTTP ${sessionRes.status}`,
      };
    }

    const sessionJson = await sessionRes.json();
    const sessionData: WaAkgSessionData = sessionJson.data || sessionJson;

    // 2. If not connected, fetch the live QR code
    let qrBase64: string | null = null;
    const isConnected = sessionData.status === "CONNECTED";

    if (!isConnected) {
      try {
        const qrController = new AbortController();
        const qrTimeout = setTimeout(() => qrController.abort(), 3000);

        const qrRes = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/qr`, {
          method: "GET",
          headers: getHeaders(),
          signal: qrController.signal,
          cache: "no-store",
        }).finally(() => clearTimeout(qrTimeout));

        if (qrRes.ok) {
          const qrJson = await qrRes.json();
          if (qrJson.base64) {
            qrBase64 = qrJson.base64;
          }
        }
      } catch {
        // Non-blocking if QR endpoint is pending
      }
    }

    return {
      online: true,
      provider: "wa_akg",
      baseUrl,
      sessionId,
      session: sessionData,
      qrBase64,
    };
  } catch (error) {
    return {
      online: false,
      provider: "wa_akg",
      baseUrl,
      sessionId,
      session: null,
      error: error instanceof Error ? error.message : "WA-AKG gateway is offline or unreachable.",
    };
  }
}

/**
 * Perform a session lifecycle action: start, stop, restart, logout, or pair
 */
export async function performWaAkgAction(
  action: "start" | "stop" | "restart" | "logout" | "pair" | "create_session" | "auto_webhook",
  payload?: { phoneNumber?: string; webhookUrl?: string },
): Promise<{ success: boolean; message: string; data?: unknown }> {
  const baseUrl = getBaseUrl();
  const sessionId = getSessionId();

  if (action === "create_session") {
    // Call POST /api/sessions to create session
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        name: `${process.env.NEXT_PUBLIC_APP_NAME || "WhatsApp Agent"} WhatsApp`,
        sessionId,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || data.error || `Failed to create session (${res.status})`);
    }
    return { success: true, message: "Session initialized successfully", data };
  }

  if (action === "auto_webhook") {
    const targetUrl = payload?.webhookUrl || "http://localhost:3000/api/webhook/wa-akg";
    const res = await fetch(`${baseUrl}/api/webhooks/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        name: `${process.env.NEXT_PUBLIC_APP_NAME || "WhatsApp Agent"} Webhook Auto-Registered`,
        url: targetUrl,
        events: ["messages.upsert"],
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // If already exists or error, inspect message
      if (res.status === 400 && data.message?.includes("already exists")) {
        return { success: true, message: "Webhook is already registered.", data };
      }
      throw new Error(data.message || data.error || `Failed to register webhook (${res.status})`);
    }
    return { success: true, message: `Webhook successfully linked to ${process.env.NEXT_PUBLIC_APP_NAME || "WhatsApp Agent"}!`, data };
  }

  // Generic session action (/api/sessions/[sessionId]/[action])
  const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/${action}`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload || {}),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || `Action '${action}' failed (${res.status})`);
  }

  return {
    success: true,
    message: data.message || `Session action '${action}' completed`,
    data: data.data,
  };
}
