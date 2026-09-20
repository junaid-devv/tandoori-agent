-- Add menu display mode and WhatsApp provider configuration to restaurant_profiles
-- These columns enable white-labeling: each project can configure how menus
-- are displayed and which WhatsApp provider is used, all from the dashboard.

alter table restaurant_profiles
  add column if not exists menu_display_mode text not null default 'interactive_list'
    check (menu_display_mode in ('interactive_list', 'menu_pictures', 'text_only'));

alter table restaurant_profiles
  add column if not exists menu_card_images jsonb not null default '[]'::jsonb;

alter table restaurant_profiles
  add column if not exists whatsapp_provider text not null default 'none'
    check (whatsapp_provider in ('meta', 'wa_akg', 'none'));

-- Update existing row(s) to have sensible defaults
update restaurant_profiles
set menu_display_mode = 'interactive_list',
    menu_card_images = '[]'::jsonb,
    whatsapp_provider = 'none'
where menu_display_mode is null;
