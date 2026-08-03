export type BranchMode = "single" | "multiple";

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
}
