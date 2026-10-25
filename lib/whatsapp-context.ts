import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { supabaseAdmin } from "./supabase-admin";
import { ApiRequestError } from "./api-utils";

export type WhatsAppTransport = { readOnly?: boolean } & (
  | { provider: "meta"; restaurantId: string; phoneNumberId: string }
  | { provider: "evolution"; restaurantId: string; instanceName: string });

const transportContext = new AsyncLocalStorage<WhatsAppTransport>();
export const getWhatsAppTransport = () => transportContext.getStore();
export function withWhatsAppTransport<T>(transport: WhatsAppTransport, work: () => T): T {
  return transportContext.run(transport, work);
}

export async function getActiveWhatsAppProvider(restaurantId: string): Promise<"meta" | "evolution" | "none"> {
  const { data, error } = await supabaseAdmin.from("restaurant_profiles").select("whatsapp_provider, is_active").eq("id", restaurantId).single();
  if (error || !data || data.is_active === false) throw new ApiRequestError("Restaurant is unavailable", 409);
  const provider = String(data.whatsapp_provider);
  return provider === "wa_akg" ? "evolution" : provider === "meta" || provider === "evolution" ? provider : "none";
}

export async function getTenantWhatsAppTransport(restaurantId: string): Promise<WhatsAppTransport> {
  const provider = await getActiveWhatsAppProvider(restaurantId);
  if (provider === "none") throw new ApiRequestError("WhatsApp is disabled for this restaurant", 409);
  if (provider === "evolution") {
    const { data, error } = await supabaseAdmin.from("evolution_configs").select("instance_name, connection_status")
      .eq("restaurant_id", restaurantId).eq("is_active", true).single();
    if (error || !data || data.connection_status !== "open" || data.instance_name !== `orderiq-${restaurantId}`) throw new ApiRequestError("Connect this restaurant to Evolution first", 409);
    return { provider, restaurantId, instanceName: data.instance_name };
  }
  const { data, error } = await supabaseAdmin.from("whatsapp_configs").select("phone_number_id")
    .eq("restaurant_id", restaurantId).eq("is_active", true).order("updated_at", { ascending: false }).limit(1).single();
  if (error || !data) throw new ApiRequestError("Connect this restaurant to Meta first", 409);
  return { provider, restaurantId, phoneNumberId: data.phone_number_id };
}

/** Always derive tenant ownership from the conversation, including nested calls.
 * Outbound replies follow the currently selected provider after a client switches.
 */
export async function withConversationWhatsApp<T>(conversationId: string, work: () => Promise<T>, media?: { origin?: WhatsAppTransport }): Promise<T> {
  const context = getWhatsAppTransport();
  const { data: conversation, error } = await supabaseAdmin.from("conversations")
    .select("contact_id, whatsapp_provider, whatsapp_phone_number_id, evolution_instance_name")
    .eq("id", conversationId).single();
  if (error || !conversation) throw error || new Error("Conversation not found");
  const { data: contact, error: contactError } = await supabaseAdmin.from("contacts")
    .select("restaurant_id").eq("id", conversation.contact_id).single();
  if (contactError || !contact?.restaurant_id) throw contactError || new Error("Conversation tenant is missing");
  const restaurantId = contact.restaurant_id as string;
  if (context && context.restaurantId !== restaurantId) throw new Error("Conversation belongs to another restaurant");
  if (media) {
    // Historical media belongs to the original connection, even after switching.
    const origin = media.origin;
    if (origin && origin.restaurantId !== restaurantId) throw new Error("Media belongs to another restaurant");
    const provider = origin?.provider || conversation.whatsapp_provider;
    let transport: WhatsAppTransport;
    if (provider === "evolution") {
      const instanceName = origin?.provider === "evolution" ? origin.instanceName : conversation.evolution_instance_name;
      if (instanceName !== `orderiq-${restaurantId}`) throw new Error("Media instance does not belong to this restaurant");
      transport = { provider, restaurantId, instanceName, readOnly: true };
    } else if (provider === "meta") {
      const phoneNumberId = origin?.provider === "meta" ? origin.phoneNumberId : conversation.whatsapp_phone_number_id;
      if (!phoneNumberId) throw new Error("Media connection unavailable");
      const { data, error } = await supabaseAdmin.from("whatsapp_configs").select("phone_number_id").eq("restaurant_id", restaurantId).eq("phone_number_id", phoneNumberId).maybeSingle();
      if (error || !data) throw error || new Error("Media connection unavailable");
      transport = { provider, restaurantId, phoneNumberId, readOnly: true };
    } else throw new Error("Media connection unavailable");
    return withWhatsAppTransport(transport, work);
  }
  const transport = await getTenantWhatsAppTransport(restaurantId);
  if (context && context.provider !== transport.provider) throw new Error("WhatsApp provider changed during this message; retry on the active connection");
  return withWhatsAppTransport(transport, work);
}
