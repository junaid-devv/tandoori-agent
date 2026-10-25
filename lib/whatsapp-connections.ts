import "server-only";
import { supabaseAdmin } from "./supabase-admin";
import { ApiRequestError } from "./api-utils";
import { evolutionRequest, getEvolutionConfig } from "./evolution-client";
import type { EvolutionInstance } from "./evolution-types";

export async function verifyProviderReady(restaurantId: string, provider: string) {
  if (provider === "none") return;
  if (provider === "evolution") {
    const config = await getEvolutionConfig(restaurantId);
    if (!config?.is_active || config.instance_name !== `orderiq-${restaurantId}`)
      throw new ApiRequestError("Link your phone to Evolution before activating it", 409);
    const state = await evolutionRequest(`/instance/connectionState/${encodeURIComponent(config.instance_name)}`);
    if (state.instance?.state !== "open") throw new ApiRequestError("Evolution is disconnected. Link your phone first", 409);
    const instances = await evolutionRequest<EvolutionInstance[]>(`/instance/fetchInstances?instanceName=${encodeURIComponent(config.instance_name)}`);
    const own = instances.find(item => (item.name || item.instance?.instanceName) === config.instance_name);
    const phone = String(own?.ownerJid || own?.instance?.owner || "").split("@")[0].split(":")[0];
    if (!/^\d{7,15}$/.test(phone)) throw new ApiRequestError("Evolution has not confirmed your linked phone yet. Try again shortly", 409);
    const { error } = await supabaseAdmin.from("evolution_configs").update({ connection_status: "open", display_phone_number: phone,
      verified_name: own?.profileName || own?.instance?.profileName || null, updated_at: new Date().toISOString() }).eq("restaurant_id", restaurantId);
    if (error?.code === "23505") throw new ApiRequestError("This phone is already connected to another restaurant", 409);
    if (error) throw error;
    return;
  }
  if (provider !== "meta") throw new ApiRequestError("Invalid WhatsApp provider", 400);
  const { data, error } = await supabaseAdmin.from("whatsapp_configs").select("phone_number_id, access_token")
    .eq("restaurant_id", restaurantId).eq("is_active", true).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data?.access_token) throw new ApiRequestError("Connect your Meta account first", 409);
  const response = await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(data.phone_number_id)}?fields=id`, {
    headers: { Authorization: `Bearer ${data.access_token}` }, cache: "no-store", signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new ApiRequestError("Meta authorization has expired. Connect with Facebook again", 409);
}
