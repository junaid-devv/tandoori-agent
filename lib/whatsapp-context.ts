import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { supabaseAdmin } from "./supabase-admin";
import { getRestaurantProfile } from "./restaurant-profile";

export type WhatsAppTransport =
  | { provider: "meta"; restaurantId: string; phoneNumberId: string }
  | { provider: "evolution"; restaurantId: string; instanceName: string };

const transportContext = new AsyncLocalStorage<WhatsAppTransport>();
export const getWhatsAppTransport = () => transportContext.getStore();
export function withWhatsAppTransport<T>(transport: WhatsAppTransport, work: () => T): T {
  return transportContext.run(transport, work);
}

/** Dashboard replies and notifications derive their tenant from the conversation. */
export async function withConversationWhatsApp<T>(conversationId: string, work: () => Promise<T>): Promise<T> {
  const context = getWhatsAppTransport();
  if (context) return work();
  const { data: conversation, error } = await supabaseAdmin.from("conversations")
    .select("contact_id, whatsapp_provider, whatsapp_phone_number_id, evolution_instance_name")
    .eq("id", conversationId).single();
  if (error || !conversation) throw error || new Error("Conversation not found");
  const { data: contact, error: contactError } = await supabaseAdmin.from("contacts")
    .select("restaurant_id").eq("id", conversation.contact_id).single();
  if (contactError || !contact?.restaurant_id) throw contactError || new Error("Conversation tenant is missing");
  const restaurantId = contact.restaurant_id as string;
  const profile = await getRestaurantProfile(restaurantId);
  if (profile.whatsapp_provider === "none") throw new Error("WhatsApp is disabled for this restaurant");
  const provider = conversation.whatsapp_provider || profile.whatsapp_provider;
  if (provider === "evolution") {
    const { data: config, error: configError } = await supabaseAdmin.from("evolution_configs")
      .select("instance_name").eq("restaurant_id", restaurantId).eq("is_active", true).single();
    if (configError || !config) throw configError || new Error("Evolution is not connected for this restaurant");
    if (conversation.evolution_instance_name && conversation.evolution_instance_name !== config.instance_name) {
      throw new Error("Conversation belongs to a different Evolution instance");
    }
    return withWhatsAppTransport({ provider, restaurantId, instanceName: config.instance_name }, work);
  }
  let query = supabaseAdmin.from("whatsapp_configs").select("phone_number_id")
    .eq("restaurant_id", restaurantId).eq("is_active", true);
  if (conversation.whatsapp_phone_number_id) query = query.eq("phone_number_id", conversation.whatsapp_phone_number_id);
  const { data: config, error: configError } = await query.order("updated_at", { ascending: false }).limit(1).single();
  if (configError || !config) throw configError || new Error("Meta is not connected for this restaurant");
  return withWhatsAppTransport({ provider: "meta", restaurantId, phoneNumberId: config.phone_number_id }, work);
}
