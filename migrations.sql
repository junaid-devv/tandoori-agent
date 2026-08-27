create extension if not exists pgcrypto;

create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  city text not null default 'City',
  address text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table branches add column if not exists city text not null default 'City';

create table if not exists restaurant_profiles (
  id text primary key default 'default',
  app_name text not null default 'Restaurant Agent',
  dashboard_title text not null default 'Restaurant Dashboard',
  logo_url text,
  brand_color text not null default '#EA580C',
  brand_hover_color text not null default '#C2410C',
  city text not null default 'City',
  currency text not null default 'Rs.',
  timezone text not null default 'Asia/Karachi',
  branch_mode text not null default 'single',
  default_branch_id uuid references branches(id) on delete set null,
  support_phone text not null default 'Update support phone',
  delivery_phone text not null default 'Update delivery phone',
  dine_in_phone text not null default 'Update dine-in phone',
  ai_personality_default text not null default 'Warm & Professional',
  updated_at timestamptz not null default now()
);
alter table restaurant_profiles drop constraint if exists restaurant_profiles_branch_mode_check;
alter table restaurant_profiles add constraint restaurant_profiles_branch_mode_check check (branch_mode in ('single', 'multiple')) not valid;
insert into restaurant_profiles (id)
values ('default')
on conflict (id) do nothing;

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text,
  active_branch_id uuid references branches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table contacts add column if not exists preferred_language text not null default 'english';
alter table contacts add column if not exists tags jsonb not null default '[]'::jsonb;
alter table contacts add column if not exists notes text;
alter table contacts add column if not exists total_orders integer not null default 0;
alter table contacts add column if not exists last_order_at timestamptz;
alter table contacts drop constraint if exists contacts_preferred_language_check;
alter table contacts add constraint contacts_preferred_language_check check (preferred_language in ('english', 'roman_urdu')) not valid;
alter table contacts drop constraint if exists contacts_tags_check;
alter table contacts add constraint contacts_tags_check check (jsonb_typeof(tags) = 'array') not valid;
alter table contacts drop constraint if exists contacts_total_orders_check;
alter table contacts add constraint contacts_total_orders_check check (total_orders >= 0) not valid;

create table if not exists customer_addresses (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  label text not null default 'Saved address',
  address text not null,
  address_key text not null,
  use_count integer not null default 1,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contact_id, branch_id, address_key)
);
alter table customer_addresses drop constraint if exists customer_addresses_use_count_check;
alter table customer_addresses add constraint customer_addresses_use_count_check check (use_count > 0) not valid;

insert into contacts (phone, name)
select distinct c.phone, c.name
from conversations c
on conflict (phone) do update set name = excluded.name;

alter table conversations add column if not exists contact_id uuid references contacts(id) on delete cascade;
alter table conversations add column if not exists branch_id uuid references branches(id) on delete cascade;
alter table conversations add column if not exists has_unread boolean not null default false;
alter table conversations add column if not exists staff_notes text;

update conversations set contact_id = contacts.id
from contacts
where conversations.contact_id is null and conversations.phone = contacts.phone;

update conversations set branch_id = fallback_branch.id
from (
  select id from branches
  where is_active = true
  order by created_at asc
  limit 1
) fallback_branch
where conversations.branch_id is null;

do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_name = 'conversations' and constraint_name = 'conversations_phone_key'
  ) then
    alter table conversations drop constraint conversations_phone_key;
  end if;
exception when undefined_object then null;
end $$;

create unique index if not exists idx_conversations_contact_branch_unique on conversations(contact_id, branch_id);

alter table restaurant_settings drop constraint if exists restaurant_settings_id_check;
alter table restaurant_settings drop constraint if exists ensure_single_row;
do $$ begin
  if not exists (select 1 from pg_class where relname = 'restaurant_settings_id_seq') then
    create sequence restaurant_settings_id_seq;
  end if;
end $$;
alter table restaurant_settings alter column id set default nextval('restaurant_settings_id_seq');
select setval('restaurant_settings_id_seq', greatest((select coalesce(max(id), 0) from restaurant_settings), 1), true);

alter table restaurant_settings add column if not exists branch_id uuid references branches(id) on delete cascade;
alter table restaurant_settings add column if not exists min_delivery_amount numeric not null default 0;
alter table restaurant_settings add column if not exists delivery_enabled boolean not null default false;
alter table restaurant_settings add column if not exists delivery_fee numeric not null default 0;
alter table restaurant_settings add column if not exists delivery_areas jsonb not null default '[]'::jsonb;
alter table restaurant_settings add column if not exists estimated_prep_minutes integer not null default 30;
alter table restaurant_settings add column if not exists estimated_delivery_minutes integer not null default 45;
alter table restaurant_settings add column if not exists city text not null default 'City';
alter table restaurant_settings add column if not exists phone_delivery text not null default 'Update delivery phone';
alter table restaurant_settings add column if not exists phone_dine_in text not null default 'Update dine-in phone';
alter table restaurant_settings add column if not exists ai_personality text not null default 'Warm & Professional';
alter table restaurant_settings drop constraint if exists restaurant_settings_delivery_areas_array_check;
alter table restaurant_settings add constraint restaurant_settings_delivery_areas_array_check check (jsonb_typeof(delivery_areas) = 'array') not valid;
alter table restaurant_settings drop constraint if exists restaurant_settings_estimated_prep_minutes_check;
alter table restaurant_settings add constraint restaurant_settings_estimated_prep_minutes_check check (estimated_prep_minutes between 5 and 240) not valid;
alter table restaurant_settings drop constraint if exists restaurant_settings_estimated_delivery_minutes_check;
alter table restaurant_settings add constraint restaurant_settings_estimated_delivery_minutes_check check (estimated_delivery_minutes between 5 and 240) not valid;

update restaurant_settings set branch_id = fallback_branch.id
from (
  select id from branches
  where is_active = true
  order by created_at asc
  limit 1
) fallback_branch
where restaurant_settings.branch_id is null;

create unique index if not exists idx_restaurant_settings_branch_id on restaurant_settings(branch_id);
insert into restaurant_settings (branch_id)
select branches.id from branches
where branches.is_active = true
on conflict (branch_id) do nothing;

alter table menu_items add column if not exists branch_id uuid references branches(id) on delete cascade;
alter table menu_items add column if not exists sort_order integer not null default 0;
alter table menu_items add column if not exists description text;
alter table menu_items add column if not exists available_days jsonb not null default '[]'::jsonb;
alter table menu_items add column if not exists available_start_time text;
alter table menu_items add column if not exists available_end_time text;
alter table menu_items drop constraint if exists menu_items_available_days_check;
alter table menu_items add constraint menu_items_available_days_check check (jsonb_typeof(available_days) = 'array') not valid;
update menu_items set branch_id = fallback_branch.id
from (
  select id from branches
  where is_active = true
  order by created_at asc
  limit 1
) fallback_branch
where menu_items.branch_id is null;

alter table menu_uploads add column if not exists branch_id uuid references branches(id) on delete cascade;
update menu_uploads set branch_id = fallback_branch.id
from (
  select id from branches
  where is_active = true
  order by created_at asc
  limit 1
) fallback_branch
where menu_uploads.branch_id is null;

create sequence if not exists messages_ingest_seq_seq;
alter table messages add column if not exists ingest_seq bigint;
alter table messages alter column ingest_seq set default nextval('messages_ingest_seq_seq');
update messages set ingest_seq = nextval('messages_ingest_seq_seq') where ingest_seq is null;
alter table messages alter column ingest_seq set not null;
alter table messages add column if not exists sender_kind text not null default 'user';
alter table messages add column if not exists delivery_status text;
alter table messages add column if not exists delivery_error text;
alter table messages add column if not exists delivery_status_updated_at timestamptz;
update messages
set sender_kind = case when role = 'user' then 'user' else 'ai' end
where sender_kind is null or sender_kind not in ('user', 'ai', 'human', 'system');
alter table messages drop constraint if exists messages_sender_kind_check;
alter table messages add constraint messages_sender_kind_check check (sender_kind in ('user', 'ai', 'human', 'system')) not valid;
alter table messages drop constraint if exists messages_delivery_status_check;
alter table messages add constraint messages_delivery_status_check check (delivery_status is null or delivery_status in ('pending', 'sent', 'delivered', 'read', 'failed')) not valid;

create table if not exists conversation_states (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references conversations(id) on delete cascade,
  workflow_step text not null default 'idle',
  cart jsonb not null default '[]'::jsonb,
  preferred_language text not null default 'english',
  resume_workflow_step text,
  last_presented_category text,
  last_presented_at timestamptz,
  last_presented_options jsonb,
  last_presented_options_at timestamptz,
  order_type text,
  address text,
  guests integer,
  reservation_time timestamptz,
  pickup_time timestamptz,
  customer_instructions text,
  upsell_item_name text,
  upsell_item_price numeric,
  upsell_offered boolean not null default false,
  declined_upsells jsonb not null default '[]'::jsonb,
  summary_sent_at timestamptz,
  last_user_whatsapp_msg_id text,
  last_processed_user_message_id text,
  last_processed_message_seq bigint,
  last_processed_user_message_at timestamptz,
  processing_token text,
  processing_started_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists order_agent_turns (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,
  whatsapp_message_id text,
  workflow_before text not null,
  workflow_after text not null,
  decision_kind text not null check (decision_kind in ('reply', 'place_order', 'fallback')),
  nlu_intent text,
  nlu_confidence numeric,
  nlu_unknown_items jsonb not null default '[]'::jsonb,
  nlu_notes text,
  processing_result text not null default 'success' check (processing_result in ('success', 'partial', 'recovered', 'failed')),
  assistant_reply text,
  error_message text,
  created_at timestamptz not null default now()
);

insert into conversation_states (conversation_id)
select id from conversations
on conflict (conversation_id) do nothing;

alter table conversation_states add column if not exists preferred_language text not null default 'english';
alter table conversation_states add column if not exists resume_workflow_step text;
alter table conversation_states add column if not exists last_processed_message_seq bigint;
alter table conversation_states add column if not exists last_presented_category text;
alter table conversation_states add column if not exists last_presented_at timestamptz;
alter table conversation_states add column if not exists last_presented_options jsonb;
alter table conversation_states add column if not exists last_presented_options_at timestamptz;
alter table conversation_states add column if not exists customer_instructions text;
alter table conversation_states add column if not exists pickup_time timestamptz;
alter table conversation_states add column if not exists declined_upsells jsonb not null default '[]'::jsonb;
alter table conversation_states drop constraint if exists conversation_states_preferred_language_check;
alter table conversation_states add constraint conversation_states_preferred_language_check check (preferred_language in ('english', 'roman_urdu')) not valid;
alter table conversation_states drop constraint if exists conversation_states_workflow_step_check;
alter table conversation_states add constraint conversation_states_workflow_step_check check (
  workflow_step in ('idle', 'awaiting_branch_selection', 'collecting_items', 'awaiting_upsell_reply', 'awaiting_order_type', 'awaiting_delivery_address', 'awaiting_dine_in_details', 'awaiting_pickup_time', 'awaiting_confirmation', 'awaiting_resume_decision')
) not valid;
alter table conversation_states drop constraint if exists conversation_states_resume_workflow_step_check;
alter table conversation_states add constraint conversation_states_resume_workflow_step_check check (
  resume_workflow_step is null or resume_workflow_step in ('idle', 'awaiting_branch_selection', 'collecting_items', 'awaiting_upsell_reply', 'awaiting_order_type', 'awaiting_delivery_address', 'awaiting_dine_in_details', 'awaiting_pickup_time', 'awaiting_confirmation')
) not valid;

alter table orders add column if not exists branch_id uuid references branches(id) on delete cascade;
alter table orders add column if not exists source_user_message_id text;
alter table orders add column if not exists assigned_to text;
alter table orders add column if not exists status_notified_at timestamptz;
alter table orders add column if not exists status_notification_status text;
alter table orders add column if not exists status_notification_error text;
alter table orders add column if not exists customer_instructions text;
alter table orders add column if not exists pickup_time timestamptz;
alter table orders add column if not exists cancellation_requested_at timestamptz;
alter table orders add column if not exists cancelled_at timestamptz;
alter table order_items add column if not exists created_at timestamptz not null default now();
alter table order_items add column if not exists size text;
alter table order_items add column if not exists addons jsonb not null default '[]'::jsonb;
alter table order_items add column if not exists item_instructions text;

update orders set branch_id = conversations.branch_id
from conversations
where orders.branch_id is null and orders.conversation_id = conversations.id;
update orders set branch_id = fallback_branch.id
from (
  select id from branches
  where is_active = true
  order by created_at asc
  limit 1
) fallback_branch
where orders.branch_id is null;

create unique index if not exists idx_orders_source_user_message_id on orders(source_user_message_id) where source_user_message_id is not null;
alter table orders drop constraint if exists orders_status_notification_status_check;
alter table orders add constraint orders_status_notification_status_check check (status_notification_status is null or status_notification_status in ('sent', 'failed', 'skipped')) not valid;
alter table conversation_states drop constraint if exists conversation_states_order_type_check;
alter table conversation_states add constraint conversation_states_order_type_check check (order_type is null or order_type in ('delivery', 'pickup', 'dine-in')) not valid;
alter table orders drop constraint if exists orders_type_check;
alter table orders add constraint orders_type_check check (type in ('delivery', 'pickup', 'dine-in')) not valid;
alter table orders drop constraint if exists orders_require_delivery_fields;
alter table orders add constraint orders_require_delivery_fields check (
  (type = 'delivery' and address is not null and guests is null and reservation_time is null and pickup_time is null)
  or
  (type = 'pickup' and address is null and guests is null and reservation_time is null and pickup_time is not null)
  or
  (type = 'dine-in' and address is null and guests is not null and reservation_time is not null and pickup_time is null)
) not valid;
alter table order_items drop constraint if exists order_items_addons_array_check;
alter table order_items add constraint order_items_addons_array_check check (jsonb_typeof(addons) = 'array') not valid;

drop function if exists place_order_from_payload(uuid, uuid, text, text, jsonb, text, text, integer, timestamptz, timestamptz, numeric);

create or replace function place_order_from_payload(
  p_conversation_id uuid,
  p_branch_id uuid,
  p_source_user_message_id text,
  p_type text,
  p_items jsonb,
  p_customer_instructions text default null,
  p_address text default null,
  p_guests integer default null,
  p_reservation_time timestamptz default null,
  p_pickup_time timestamptz default null,
  p_delivery_fee numeric default 0
) returns table (id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_order_id uuid;
  v_order_id uuid;
  v_subtotal numeric := 0;
  v_delivery_fee numeric := 0;
  v_delivery_enabled boolean := false;
  v_min_delivery_amount numeric := 0;
  v_delivery_areas jsonb := '[]'::jsonb;
  v_delivery_area_count integer := 0;
  v_delivery_area_matches boolean := true;
  v_item record;
  v_menu_item record;
  v_addons jsonb;
begin
  if p_source_user_message_id is null or btrim(p_source_user_message_id) = '' then
    raise exception 'Missing source user message id for order placement.';
  end if;

  select orders.id into v_existing_order_id
  from orders
  where source_user_message_id = p_source_user_message_id
  limit 1;

  if v_existing_order_id is not null then
    return query select v_existing_order_id;
    return;
  end if;

  if p_type not in ('delivery', 'pickup', 'dine-in') then
    raise exception 'Invalid order type: %', p_type;
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Order requires at least one item.';
  end if;

  if p_type = 'delivery' and (p_address is null or btrim(p_address) = '') then
    raise exception 'Delivery address is required.';
  end if;

  if p_type = 'delivery' then
    select
      coalesce(restaurant_settings.delivery_enabled, false),
      greatest(coalesce(restaurant_settings.delivery_fee, 0), 0),
      greatest(coalesce(restaurant_settings.min_delivery_amount, 0), 0),
      coalesce(restaurant_settings.delivery_areas, '[]'::jsonb)
    into v_delivery_enabled, v_delivery_fee, v_min_delivery_amount, v_delivery_areas
    from restaurant_settings
    where restaurant_settings.branch_id = p_branch_id
    limit 1;

    if not coalesce(v_delivery_enabled, false) then
      raise exception 'Delivery is not available for this branch.';
    end if;

    select count(*)
    into v_delivery_area_count
    from jsonb_array_elements_text(v_delivery_areas) as area(value)
    where btrim(area.value) <> '';

    if v_delivery_area_count > 0 then
      select exists (
        select 1
        from jsonb_array_elements_text(v_delivery_areas) as area(value)
        where btrim(area.value) <> ''
          and lower(coalesce(p_address, '')) like '%' || lower(btrim(area.value)) || '%'
      )
      into v_delivery_area_matches;

      if not coalesce(v_delivery_area_matches, false) then
        raise exception 'Delivery address is outside configured delivery areas.';
      end if;
    end if;
  end if;

  if p_type = 'pickup' and p_pickup_time is null then
    raise exception 'Pickup time is required.';
  end if;

  if p_type = 'dine-in' and (p_guests is null or p_guests < 1 or p_reservation_time is null) then
    raise exception 'Guest count and reservation time are required for dine-in.';
  end if;

  insert into orders (
    branch_id,
    conversation_id,
    source_user_message_id,
    type,
    subtotal,
    delivery_fee,
    customer_instructions,
    address,
    guests,
    reservation_time,
    pickup_time,
    status
  )
  values (
    p_branch_id,
    p_conversation_id,
    p_source_user_message_id,
    p_type,
    0,
    case when p_type = 'delivery' then v_delivery_fee else 0 end,
    nullif(btrim(coalesce(p_customer_instructions, '')), ''),
    case when p_type = 'delivery' then nullif(btrim(coalesce(p_address, '')), '') else null end,
    case when p_type = 'dine-in' then p_guests else null end,
    case when p_type = 'dine-in' then p_reservation_time else null end,
    case when p_type = 'pickup' then p_pickup_time else null end,
    'received'
  )
  returning orders.id, orders.delivery_fee into v_order_id, v_delivery_fee;

  for v_item in
    select *
    from jsonb_to_recordset(p_items) as item(
      name text,
      qty integer,
      size text,
      addons jsonb,
      item_instructions text
    )
  loop
    if v_item.name is null or btrim(v_item.name) = '' then
      raise exception 'Order item name is required.';
    end if;

    if v_item.qty is null or v_item.qty < 1 or v_item.qty > 50 then
      raise exception 'Invalid quantity for %.', v_item.name;
    end if;

    select menu_items.name, menu_items.price
    into v_menu_item
    from menu_items
    where menu_items.branch_id = p_branch_id
      and menu_items.is_available = true
      and (
        coalesce(jsonb_array_length(menu_items.available_days), 0) = 0
        or lower(to_char(now(), 'dy')) in (
          select lower(left(day.value, 3))
          from jsonb_array_elements_text(menu_items.available_days) as day(value)
        )
      )
      and (
        menu_items.available_start_time is null
        or menu_items.available_end_time is null
        or menu_items.available_start_time = menu_items.available_end_time
        or (
          menu_items.available_start_time < menu_items.available_end_time
          and to_char(now(), 'HH24:MI') between menu_items.available_start_time and menu_items.available_end_time
        )
        or (
          menu_items.available_start_time > menu_items.available_end_time
          and (
            to_char(now(), 'HH24:MI') >= menu_items.available_start_time
            or to_char(now(), 'HH24:MI') <= menu_items.available_end_time
          )
        )
      )
      and lower(menu_items.name) = lower(v_item.name)
    order by menu_items.sort_order asc, menu_items.created_at asc
    limit 1;

    if v_menu_item.name is null then
      raise exception 'Menu item no longer exists: %', v_item.name;
    end if;

    v_addons := case
      when jsonb_typeof(v_item.addons) = 'array' then v_item.addons
      else '[]'::jsonb
    end;

    insert into order_items (
      order_id,
      name,
      qty,
      price,
      size,
      addons,
      item_instructions
    )
    values (
      v_order_id,
      v_menu_item.name,
      v_item.qty,
      v_menu_item.price,
      nullif(btrim(coalesce(v_item.size, '')), ''),
      v_addons,
      nullif(btrim(coalesce(v_item.item_instructions, '')), '')
    );

    v_subtotal := v_subtotal + (v_menu_item.price * v_item.qty);
  end loop;

  update orders
  set subtotal = v_subtotal
  where orders.id = v_order_id;

  if p_type = 'delivery' and v_min_delivery_amount > 0 and v_subtotal < v_min_delivery_amount then
    raise exception 'Minimum delivery order is Rs. %, current subtotal is Rs. %.', v_min_delivery_amount, v_subtotal;
  end if;

  return query select v_order_id;
exception
  when unique_violation then
    select orders.id into v_existing_order_id
    from orders
    where source_user_message_id = p_source_user_message_id
    limit 1;

    if v_existing_order_id is not null then
      return query select v_existing_order_id;
      return;
    end if;

    raise;
end;
$$;

revoke all on function place_order_from_payload(uuid, uuid, text, text, jsonb, text, text, integer, timestamptz, timestamptz, numeric) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function place_order_from_payload(uuid, uuid, text, text, jsonb, text, text, integer, timestamptz, timestamptz, numeric) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function place_order_from_payload(uuid, uuid, text, text, jsonb, text, text, integer, timestamptz, timestamptz, numeric) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function place_order_from_payload(uuid, uuid, text, text, jsonb, text, text, integer, timestamptz, timestamptz, numeric) to service_role;
  end if;
end $$;

update contacts set active_branch_id = fallback_branch.id
from (
  select id from branches
  where is_active = true
  order by created_at asc
  limit 1
) fallback_branch
where contacts.active_branch_id is null;

create table if not exists staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'branch_staff' check (role in ('admin', 'branch_staff')),
  default_branch_id uuid references branches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists staff_branch_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, branch_id)
);

create table if not exists rate_limits (
  scope text not null,
  identifier_hash text not null,
  request_count integer not null default 0 check (request_count >= 0),
  window_start timestamptz not null default now(),
  blocked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, identifier_hash)
);

create or replace function check_rate_limit(
  p_scope text,
  p_identifier_hash text,
  p_limit integer,
  p_window_seconds integer,
  p_block_seconds integer default 0
) returns table (
  allowed boolean,
  remaining integer,
  reset_at timestamptz,
  blocked_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window interval := greatest(coalesce(p_window_seconds, 1), 1) * interval '1 second';
  v_block interval := greatest(coalesce(p_block_seconds, 0), 0) * interval '1 second';
  v_limit integer := greatest(coalesce(p_limit, 1), 1);
  v_row rate_limits%rowtype;
  v_next_count integer;
  v_blocked_until timestamptz;
begin
  if p_scope is null or btrim(p_scope) = '' or p_identifier_hash is null or btrim(p_identifier_hash) = '' then
    raise exception 'Rate limit scope and identifier are required.';
  end if;

  insert into rate_limits (scope, identifier_hash, request_count, window_start)
  values (left(btrim(p_scope), 80), btrim(p_identifier_hash), 0, v_now)
  on conflict (scope, identifier_hash) do nothing;

  select *
  into v_row
  from rate_limits
  where scope = left(btrim(p_scope), 80)
    and identifier_hash = btrim(p_identifier_hash)
  for update;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    allowed := false;
    remaining := 0;
    reset_at := v_row.window_start + v_window;
    blocked_until := v_row.blocked_until;
    return next;
    return;
  end if;

  if v_row.window_start + v_window <= v_now then
    v_next_count := 1;
    update rate_limits
    set request_count = v_next_count,
        window_start = v_now,
        blocked_until = null,
        updated_at = v_now
    where scope = v_row.scope
      and identifier_hash = v_row.identifier_hash;

    allowed := true;
    remaining := greatest(v_limit - v_next_count, 0);
    reset_at := v_now + v_window;
    blocked_until := null;
    return next;
    return;
  end if;

  v_next_count := v_row.request_count + 1;
  v_blocked_until := case when v_next_count > v_limit and v_block > interval '0 seconds' then v_now + v_block else null end;

  update rate_limits
  set request_count = v_next_count,
      blocked_until = v_blocked_until,
      updated_at = v_now
  where scope = v_row.scope
    and identifier_hash = v_row.identifier_hash;

  allowed := v_next_count <= v_limit;
  remaining := greatest(v_limit - v_next_count, 0);
  reset_at := v_row.window_start + v_window;
  blocked_until := v_blocked_until;
  return next;
end;
$$;

revoke all on function check_rate_limit(text, text, integer, integer, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function check_rate_limit(text, text, integer, integer, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function check_rate_limit(text, text, integer, integer, integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function check_rate_limit(text, text, integer, integer, integer) to service_role;
  end if;
end $$;

create index if not exists idx_contacts_active_branch on contacts(active_branch_id);
create index if not exists idx_customer_addresses_contact_branch on customer_addresses(contact_id, branch_id, last_used_at desc);
create index if not exists idx_conversations_branch_updated on conversations(branch_id, updated_at desc);
create index if not exists idx_messages_conversation_created on messages(conversation_id, created_at desc);
create unique index if not exists idx_messages_ingest_seq on messages(ingest_seq);
create index if not exists idx_messages_conversation_ingest_seq on messages(conversation_id, ingest_seq asc);
create index if not exists idx_messages_whatsapp_msg_id on messages(whatsapp_msg_id) where whatsapp_msg_id is not null;
create unique index if not exists idx_messages_whatsapp_msg_id_unique on messages(whatsapp_msg_id) where whatsapp_msg_id is not null;
create index if not exists idx_orders_branch_created on orders(branch_id, created_at desc);
create index if not exists idx_orders_status on orders(status);
create index if not exists idx_orders_branch_status_created on orders(branch_id, status, created_at desc);
create index if not exists idx_conversations_unread_branch_updated on conversations(has_unread, branch_id, updated_at desc);
create index if not exists idx_conversation_states_conversation on conversation_states(conversation_id);
create index if not exists idx_order_agent_turns_conversation_created on order_agent_turns(conversation_id, created_at desc);
create index if not exists idx_order_agent_turns_message on order_agent_turns(message_id);
create index if not exists idx_menu_items_branch_name_lookup on menu_items(branch_id, lower(trim(name)));
create index if not exists idx_menu_uploads_branch_created on menu_uploads(branch_id, created_at desc);
create index if not exists idx_rate_limits_updated_at on rate_limits(updated_at);

create or replace function update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists update_branches_updated_at on branches;
create trigger update_branches_updated_at before update on branches for each row execute function update_updated_at_column();
drop trigger if exists update_restaurant_profiles_updated_at on restaurant_profiles;
create trigger update_restaurant_profiles_updated_at before update on restaurant_profiles for each row execute function update_updated_at_column();
drop trigger if exists update_contacts_updated_at on contacts;
create trigger update_contacts_updated_at before update on contacts for each row execute function update_updated_at_column();
drop trigger if exists update_customer_addresses_updated_at on customer_addresses;
create trigger update_customer_addresses_updated_at before update on customer_addresses for each row execute function update_updated_at_column();
drop trigger if exists update_conversations_updated_at on conversations;
create trigger update_conversations_updated_at before update on conversations for each row execute function update_updated_at_column();
drop trigger if exists update_restaurant_settings_updated_at on restaurant_settings;
create trigger update_restaurant_settings_updated_at before update on restaurant_settings for each row execute function update_updated_at_column();
drop trigger if exists update_menu_items_updated_at on menu_items;
create trigger update_menu_items_updated_at before update on menu_items for each row execute function update_updated_at_column();
drop trigger if exists update_conversation_states_updated_at on conversation_states;
create trigger update_conversation_states_updated_at before update on conversation_states for each row execute function update_updated_at_column();
drop trigger if exists update_orders_updated_at on orders;
create trigger update_orders_updated_at before update on orders for each row execute function update_updated_at_column();
drop trigger if exists update_staff_profiles_updated_at on staff_profiles;
create trigger update_staff_profiles_updated_at before update on staff_profiles for each row execute function update_updated_at_column();
drop trigger if exists update_rate_limits_updated_at on rate_limits;
create trigger update_rate_limits_updated_at before update on rate_limits for each row execute function update_updated_at_column();

alter table branches enable row level security;
alter table restaurant_profiles enable row level security;
alter table contacts enable row level security;
alter table customer_addresses enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table restaurant_settings enable row level security;
alter table menu_items enable row level security;
alter table menu_uploads enable row level security;
alter table conversation_states enable row level security;
alter table order_agent_turns enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table staff_profiles enable row level security;
alter table staff_branch_access enable row level security;
alter table rate_limits enable row level security;

drop policy if exists "service_branches" on branches;
create policy "service_branches" on branches for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "service_restaurant_profiles" on restaurant_profiles;
create policy "service_restaurant_profiles" on restaurant_profiles for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "service_contacts" on contacts;
create policy "service_contacts" on contacts for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "service_customer_addresses" on customer_addresses;
create policy "service_customer_addresses" on customer_addresses for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "service_conversations" on conversations;
create policy "service_conversations" on conversations for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "service_messages" on messages;
create policy "service_messages" on messages for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "service_settings" on restaurant_settings;
create policy "service_settings" on restaurant_settings for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "service_menu_items" on menu_items;
create policy "service_menu_items" on menu_items for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "service_menu_uploads" on menu_uploads;
create policy "service_menu_uploads" on menu_uploads for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "service_conversation_states" on conversation_states;
create policy "service_conversation_states" on conversation_states for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "service_order_agent_turns" on order_agent_turns;
create policy "service_order_agent_turns" on order_agent_turns for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "service_orders" on orders;
create policy "service_orders" on orders for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "service_order_items" on order_items;
create policy "service_order_items" on order_items for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "service_staff_profiles" on staff_profiles;
create policy "service_staff_profiles" on staff_profiles for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "service_staff_branch_access" on staff_branch_access;
create policy "service_staff_branch_access" on staff_branch_access for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "service_rate_limits" on rate_limits;
create policy "service_rate_limits" on rate_limits for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'branches') then
    alter publication supabase_realtime add table branches;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'restaurant_profiles') then
    alter publication supabase_realtime add table restaurant_profiles;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'conversations') then
    alter publication supabase_realtime add table conversations;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'customer_addresses') then
    alter publication supabase_realtime add table customer_addresses;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'conversation_states') then
    alter publication supabase_realtime add table conversation_states;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'order_agent_turns') then
    alter publication supabase_realtime add table order_agent_turns;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
    alter publication supabase_realtime add table messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'orders') then
    alter publication supabase_realtime add table orders;
  end if;
end $$;

create or replace function apply_menu_catalog(branch_uuid uuid, menu_payload jsonb, replace_all boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  duplicate_name text;
begin
  select lower(trim(item.name))
  into duplicate_name
  from jsonb_to_recordset(menu_payload) as item(
    name text,
    price numeric,
    category text,
    description text,
    is_available boolean,
    available_days jsonb,
    available_start_time text,
    available_end_time text,
    sort_order integer
  )
  group by lower(trim(item.name))
  having count(*) > 1
  limit 1;

  if duplicate_name is not null then
    raise exception 'Duplicate menu item in payload: %', duplicate_name;
  end if;

  create temp table tmp_menu_payload (
    normalized_name text primary key,
    name text not null,
    price numeric not null,
    category text,
    description text,
    is_available boolean not null,
    available_days jsonb not null,
    available_start_time text,
    available_end_time text,
    sort_order integer not null
  ) on commit drop;

  insert into tmp_menu_payload (normalized_name, name, price, category, description, is_available, available_days, available_start_time, available_end_time, sort_order)
  select lower(trim(item.name)), trim(item.name), item.price,
    nullif(regexp_replace(trim(coalesce(item.category, '')), '\s+', ' ', 'g'), ''),
    nullif(trim(item.description), ''), coalesce(item.is_available, true),
    case when jsonb_typeof(coalesce(item.available_days, '[]'::jsonb)) = 'array' then coalesce(item.available_days, '[]'::jsonb) else '[]'::jsonb end,
    nullif(trim(coalesce(item.available_start_time, '')), ''),
    nullif(trim(coalesce(item.available_end_time, '')), ''),
    coalesce(item.sort_order, 0)
  from jsonb_to_recordset(menu_payload) as item(
    name text,
    price numeric,
    category text,
    description text,
    is_available boolean,
    available_days jsonb,
    available_start_time text,
    available_end_time text,
    sort_order integer
  )
  where trim(coalesce(item.name, '')) <> '';

  update menu_items as existing
  set name = incoming.name, price = incoming.price, category = incoming.category, description = incoming.description, is_available = incoming.is_available,
      available_days = incoming.available_days, available_start_time = incoming.available_start_time, available_end_time = incoming.available_end_time,
      sort_order = incoming.sort_order
  from tmp_menu_payload as incoming
  where existing.branch_id = branch_uuid and lower(trim(existing.name)) = incoming.normalized_name;

  insert into menu_items (branch_id, name, price, category, description, is_available, available_days, available_start_time, available_end_time, sort_order)
  select branch_uuid, incoming.name, incoming.price, incoming.category, incoming.description, incoming.is_available, incoming.available_days, incoming.available_start_time, incoming.available_end_time, incoming.sort_order
  from tmp_menu_payload as incoming
  where not exists (
    select 1 from menu_items as existing
    where existing.branch_id = branch_uuid and lower(trim(existing.name)) = incoming.normalized_name
  );

  if replace_all then
    delete from menu_items as existing
    where existing.branch_id = branch_uuid
      and not exists (
        select 1 from tmp_menu_payload as incoming
        where incoming.normalized_name = lower(trim(existing.name))
      );
  end if;

  return jsonb_build_object('branch_id', branch_uuid, 'applied', (select count(*) from tmp_menu_payload), 'replace_all', replace_all);
end;
$$;

create or replace function replace_menu_items(branch_uuid uuid, menu_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform apply_menu_catalog(branch_uuid, menu_payload, true);
end;
$$;

create extension if not exists vector;

create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'meta_whatsapp',
  delivery_key text not null unique,
  raw_body text not null,
  payload jsonb not null,
  signature text,
  status text not null default 'received',
  attempt_count integer not null default 0,
  received_count integer not null default 1,
  processing_started_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table webhook_events drop constraint if exists webhook_events_status_check;
alter table webhook_events add constraint webhook_events_status_check check (
  status in ('received', 'processing', 'processed', 'failed')
) not valid;

create or replace function claim_webhook_event(
  p_event_id uuid,
  p_stale_after_seconds integer default 90
) returns setof webhook_events
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update webhook_events
  set status = 'processing',
      attempt_count = webhook_events.attempt_count + 1,
      processing_started_at = clock_timestamp(),
      last_error = null,
      updated_at = clock_timestamp()
  where id = p_event_id
    and (
      status in ('received', 'failed')
      or (
        status = 'processing'
        and (
          processing_started_at is null
          or processing_started_at < clock_timestamp() - greatest(coalesce(p_stale_after_seconds, 90), 1) * interval '1 second'
        )
      )
    )
  returning webhook_events.*;
end;
$$;

revoke all on function claim_webhook_event(uuid, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function claim_webhook_event(uuid, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function claim_webhook_event(uuid, integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function claim_webhook_event(uuid, integer) to service_role;
  end if;
end $$;

create table if not exists user_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references conversations(id) on delete cascade,
  active_node text not null default 'cart_builder',
  return_node text,
  status text not null default 'active',
  is_bot_active boolean not null default true,
  invalid_step_count integer not null default 0,
  consecutive_tool_failures integer not null default 0,
  anger_level integer not null default 0,
  last_intent text,
  last_tool_name text,
  last_tool_error text,
  last_user_message text,
  last_assistant_reply text,
  last_semantic_candidates jsonb not null default '[]'::jsonb,
  escalation_reason text,
  escalated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table user_sessions drop constraint if exists user_sessions_active_node_check;
alter table user_sessions add constraint user_sessions_active_node_check check (
  active_node in ('branch_selection', 'menu_lookup', 'cart_builder', 'checkout', 'order_review', 'support', 'human_handoff')
) not valid;
alter table user_sessions drop constraint if exists user_sessions_return_node_check;
alter table user_sessions add constraint user_sessions_return_node_check check (
  return_node is null or return_node in ('branch_selection', 'menu_lookup', 'cart_builder', 'checkout', 'order_review', 'support', 'human_handoff')
) not valid;
alter table user_sessions drop constraint if exists user_sessions_status_check;
alter table user_sessions add constraint user_sessions_status_check check (
  status in ('active', 'paused', 'human_handoff')
) not valid;

create table if not exists staff_alerts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  kind text not null,
  severity text not null default 'medium',
  status text not null default 'open',
  message text not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table staff_alerts drop constraint if exists staff_alerts_kind_check;
alter table staff_alerts add constraint staff_alerts_kind_check check (
  kind in ('human_handoff', 'tool_validation', 'webhook_processing', 'delivery_notification', 'customer_cancellation')
) not valid;
alter table staff_alerts drop constraint if exists staff_alerts_severity_check;
alter table staff_alerts add constraint staff_alerts_severity_check check (
  severity in ('low', 'medium', 'high')
) not valid;
alter table staff_alerts drop constraint if exists staff_alerts_status_check;
alter table staff_alerts add constraint staff_alerts_status_check check (
  status in ('open', 'acknowledged', 'resolved')
) not valid;

create table if not exists menu_item_embeddings (
  menu_item_id uuid primary key references menu_items(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  embedding vector(1536) not null,
  embedding_model text not null,
  embedding_source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_webhook_events_status_created on webhook_events(status, created_at desc);
create index if not exists idx_user_sessions_conversation on user_sessions(conversation_id);
create index if not exists idx_user_sessions_status on user_sessions(status, updated_at desc);
create index if not exists idx_staff_alerts_conversation_status on staff_alerts(conversation_id, status, created_at desc);
create index if not exists idx_staff_alerts_branch_status on staff_alerts(branch_id, status, created_at desc);
create index if not exists idx_menu_item_embeddings_branch on menu_item_embeddings(branch_id);

alter table webhook_events enable row level security;
alter table user_sessions enable row level security;
alter table staff_alerts enable row level security;
alter table menu_item_embeddings enable row level security;

drop policy if exists "service_webhook_events" on webhook_events;
create policy "service_webhook_events" on webhook_events for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "service_user_sessions" on user_sessions;
create policy "service_user_sessions" on user_sessions for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "service_staff_alerts" on staff_alerts;
create policy "service_staff_alerts" on staff_alerts for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "service_menu_item_embeddings" on menu_item_embeddings;
create policy "service_menu_item_embeddings" on menu_item_embeddings for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop trigger if exists update_webhook_events_updated_at on webhook_events;
create trigger update_webhook_events_updated_at before update on webhook_events for each row execute function update_updated_at_column();
drop trigger if exists update_user_sessions_updated_at on user_sessions;
create trigger update_user_sessions_updated_at before update on user_sessions for each row execute function update_updated_at_column();
drop trigger if exists update_staff_alerts_updated_at on staff_alerts;
create trigger update_staff_alerts_updated_at before update on staff_alerts for each row execute function update_updated_at_column();
drop trigger if exists update_menu_item_embeddings_updated_at on menu_item_embeddings;
create trigger update_menu_item_embeddings_updated_at before update on menu_item_embeddings for each row execute function update_updated_at_column();

alter table order_agent_turns drop constraint if exists order_agent_turns_decision_kind_check;
alter table order_agent_turns add constraint order_agent_turns_decision_kind_check check (
  decision_kind in ('reply', 'place_order', 'fallback', 'escalate_to_human')
) not valid;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'user_sessions') then
    alter publication supabase_realtime add table user_sessions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'staff_alerts') then
    alter publication supabase_realtime add table staff_alerts;
  end if;
end $$;

-- Branch city mapping for city -> branch conversational flow
alter table branches add column if not exists city text not null default 'City';
update branches as b
set city = coalesce(nullif(trim(rs.city), ''), b.city)
from restaurant_settings as rs
where rs.branch_id = b.id;
create index if not exists idx_branches_city_active on branches(lower(city), is_active);

create or replace function match_menu_items_by_embedding(
  branch_uuid uuid,
  query_embedding vector(1536),
  match_count integer default 5,
  similarity_threshold double precision default 0.52
)
returns table (
  id uuid,
  name text,
  price numeric,
  category text,
  description text,
  is_available boolean,
  similarity double precision
)
language sql
security definer
set search_path = public
as $$
  select
    mi.id,
    mi.name,
    mi.price,
    mi.category,
    mi.description,
    mi.is_available,
    1 - (mie.embedding <=> query_embedding) as similarity
  from menu_item_embeddings as mie
  join menu_items as mi on mi.id = mie.menu_item_id
  where mie.branch_id = branch_uuid
    and mi.is_available = true
    and (
      coalesce(jsonb_array_length(mi.available_days), 0) = 0
      or lower(to_char(now(), 'dy')) in (
        select lower(left(day.value, 3))
        from jsonb_array_elements_text(mi.available_days) as day(value)
      )
    )
    and (
      mi.available_start_time is null
      or mi.available_end_time is null
      or mi.available_start_time = mi.available_end_time
      or (
        mi.available_start_time < mi.available_end_time
        and to_char(now(), 'HH24:MI') between mi.available_start_time and mi.available_end_time
      )
      or (
        mi.available_start_time > mi.available_end_time
        and (
          to_char(now(), 'HH24:MI') >= mi.available_start_time
          or to_char(now(), 'HH24:MI') <= mi.available_end_time
        )
      )
    )
    and 1 - (mie.embedding <=> query_embedding) >= similarity_threshold
  order by mie.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;
