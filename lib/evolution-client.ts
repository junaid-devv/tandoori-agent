import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "./supabase-admin";
import type { EvolutionInstance, EvolutionResponse } from "./evolution-types";

export type EvolutionConfig = {
  restaurant_id: string;
  instance_name: string;
  is_active: boolean;
  connection_status: string;
  display_phone_number: string | null;
  verified_name: string | null;
  interactive_mode?: "compatible" | "native";
};
export type EvolutionAction = "start" | "stop" | "restart" | "logout" | "pair" | "create_session" | "auto_webhook";

export function evolutionEnvironment() {
  const baseUrl = process.env.EVOLUTION_API_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  if (!baseUrl || !apiKey) throw new Error("Configure EVOLUTION_API_BASE_URL and EVOLUTION_API_KEY on the server");
  const url = new URL(baseUrl);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid Evolution server URL");
  return { baseUrl, apiKey };
}

export class EvolutionApiError extends Error {
  readonly status: number;
  constructor(status: number) { super(`Evolution API request failed (${status})`); this.status = status; }
}

// Never return the gateway's full response to the browser: it may contain API keys.
export async function evolutionRequest<T = EvolutionResponse>(path: string, method = "GET", body?: unknown): Promise<T> {
  const { baseUrl, apiKey } = evolutionEnvironment();
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers: { apikey: apiKey, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store", signal: AbortSignal.timeout(15_000), redirect: "error",
  });
  if (!response.ok) throw new EvolutionApiError(response.status);
  return await response.json() as T;
}

export async function getEvolutionConfig(restaurantId: string): Promise<EvolutionConfig | null> {
  const { data, error } = await supabaseAdmin.from("evolution_configs").select("*")
    .eq("restaurant_id", restaurantId).maybeSingle();
  if (error) throw error;
  return data as EvolutionConfig | null;
}

export function evolutionWebhookToken(instanceName: string): string {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("EVOLUTION_WEBHOOK_SECRET must contain at least 32 characters");
  return createHmac("sha256", secret).update(`evolution:${instanceName}`).digest("hex");
}
export function verifyEvolutionWebhook(instanceName: string, authorization: string | null): boolean {
  const supplied = Buffer.from(authorization || "");
  const expected = Buffer.from(`Bearer ${evolutionWebhookToken(instanceName)}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function webhook(instanceName: string) {
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("Set APP_URL to the public HTTPS address of your dashboard");
  const url = new URL("/api/webhook/evolution", appUrl);
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error("Evolution webhooks require a public HTTPS APP_URL");
  return { enabled: true, url: url.toString(), byEvents: false, base64: false,
    headers: { authorization: `Bearer ${evolutionWebhookToken(instanceName)}` },
    events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"] };
}

export async function performEvolutionAction(action: EvolutionAction, restaurantId: string, phoneNumber?: string) {
  evolutionEnvironment();
  let config = await getEvolutionConfig(restaurantId);
  if (!config) {
    const { data, error } = await supabaseAdmin.from("evolution_configs").upsert({
      restaurant_id: restaurantId, instance_name: `orderiq-${restaurantId}`, is_active: true,
    }, { onConflict: "restaurant_id", ignoreDuplicates: true }).select("*").maybeSingle();
    if (error) throw error;
    config = data as EvolutionConfig | null || await getEvolutionConfig(restaurantId);
  }
  if (!config) throw new Error("Could not allocate tenant Evolution instance");
  const instance = encodeURIComponent(config.instance_name);
  if (action === "pair" && !/^\d{7,15}$/.test(phoneNumber || "")) throw new Error("Enter a phone number with country code (7–15 digits)");
  const hook = webhook(config.instance_name);
  if (["start", "pair", "create_session"].includes(action)) {
    // Look up only this tenant's deterministic instance. Never adopt a caller-supplied instance.
    let existing: EvolutionInstance[];
    try { existing = await evolutionRequest<EvolutionInstance[]>(`/instance/fetchInstances?instanceName=${instance}`); }
    catch (error) { if (error instanceof EvolutionApiError && error.status === 404) existing = []; else throw error; }
    if (!Array.isArray(existing)) throw new Error("Unexpected Evolution instance response");
    if (!existing.some(item => (item.name || item.instance?.instanceName) === config!.instance_name)) {
      await evolutionRequest("/instance/create", "POST", {
        instanceName: config.instance_name, integration: "WHATSAPP-BAILEYS", qrcode: false,
        groupsIgnore: true, readMessages: false, syncFullHistory: false, webhook: hook,
      });
    }
    await evolutionRequest(`/webhook/set/${instance}`, "POST", { webhook: hook });
    const activated = await supabaseAdmin.from("evolution_configs").update({ is_active: true, updated_at: new Date().toISOString() }).eq("restaurant_id", restaurantId);
    if (activated.error) throw activated.error;
    const data = await evolutionRequest(`/instance/connect/${instance}${action === "pair" ? `?number=${encodeURIComponent(phoneNumber!)}` : ""}`);
    const { error } = await supabaseAdmin.from("evolution_configs").update({ is_active: true, updated_at: new Date().toISOString() }).eq("restaurant_id", restaurantId);
    if (error) throw error;
    return { success: true, message: "Evolution instance ready. Link your phone to finish connecting.", data: {
      pairingCode: typeof data.pairingCode === "string" ? data.pairingCode : null,
      qrBase64: typeof data.base64 === "string" ? data.base64 : null,
    } };
  }
  if (action === "auto_webhook") {
    await evolutionRequest(`/webhook/set/${instance}`, "POST", { webhook: hook });
  } else {
    await evolutionRequest(`/instance/${action === "stop" || action === "logout" ? "logout" : "restart"}/${instance}`,
      action === "stop" || action === "logout" ? "DELETE" : "PUT");
    if (action === "stop" || action === "logout") {
      const { error } = await supabaseAdmin.rpc("disconnect_whatsapp_provider", { p_restaurant_id: restaurantId, p_provider: "evolution" });
      if (error) throw error;
    }
  }
  if (action === "restart") {
    const data = await evolutionRequest(`/instance/connect/${instance}`);
    return { success: true, message: "Evolution restarted.", data: {
      pairingCode: typeof data.pairingCode === "string" ? data.pairingCode : null,
      qrBase64: typeof data.base64 === "string" ? data.base64 : null,
    } };
  }
  return { success: true, message: action === "auto_webhook" ? "Tenant webhook linked securely." : `Evolution ${action} completed.` };
}

export async function getEvolutionFullStatus(restaurantId: string) {
  const config = await getEvolutionConfig(restaurantId);
  const base = { provider: "evolution" as const, instanceName: config?.instance_name || null, sessionId: config?.instance_name || "", online: false, session: null as { sessionId: string; status: string; me: { id: string | null; name: string | null }; hasInstance: boolean } | null, qrBase64: null as string | null, error: null as string | null };
  try {
    evolutionEnvironment();
    if (!config) return { ...base, interactiveMode: "compatible" as const, online: true, error: "Create an Evolution connection for this restaurant." };
    const instance = encodeURIComponent(config.instance_name);
    const state = await evolutionRequest(`/instance/connectionState/${instance}`);
    const connection = state.instance?.state || "close";
    const session = { sessionId: config.instance_name, status: connection === "open" && config.is_active ? "CONNECTED" : connection === "connecting" ? "CONNECTING" : "DISCONNECTED", me: { id: config.display_phone_number, name: config.verified_name }, hasInstance: true };
    // GET status must never create/restart an instance or refresh QR codes as a side effect.
    return { ...base, interactiveMode: config.interactive_mode || "compatible", online: true, session };
  } catch (error) {
    return { ...base, interactiveMode: config?.interactive_mode || "compatible", error: error instanceof Error ? error.message : "Evolution server is unavailable" };
  }
}
