export type BranchMode = "single" | "multiple";

export type MenuDisplayMode = "interactive_list" | "menu_pictures" | "text_only";

export interface RestaurantProfile {
  id: string;
  app_name: string;
  dashboard_title: string;
  logo_url: string | null;
  brand_color: string;
  brand_hover_color: string;
  city: string;
  currency: string;
  timezone: string;
  branch_mode: BranchMode;
  default_branch_id: string | null;
  support_phone: string;
  delivery_phone: string;
  dine_in_phone: string;
  ai_personality_default: string;
  menu_display_mode: MenuDisplayMode;
  menu_card_images: string[];
  whatsapp_provider: "meta" | "wa_akg" | "none";
}
