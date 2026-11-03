-- An opt-in rate advertised for staff-quoted deliveries outside fixed zones.
-- It is not a final fee: placement still requires a verified delivery quote.
alter table public.restaurant_settings
  add column if not exists delivery_outside_area_per_km numeric not null default 0
  constraint restaurant_settings_outside_area_rate_check check (
    delivery_outside_area_per_km between 0 and 100000
    and delivery_outside_area_per_km = round(delivery_outside_area_per_km, 2)
  );
