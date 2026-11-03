-- Area prices are branch settings. Existing branches retain flat pricing.
alter table public.restaurant_settings
  add column if not exists delivery_pricing_mode text not null default 'flat',
  add column if not exists delivery_zones jsonb not null default '[]'::jsonb;
alter table public.conversation_states add column if not exists delivery_fee_quote numeric;

-- Validate JSON even for writes made outside the dashboard.
create or replace function public.valid_delivery_zones(zones jsonb)
returns boolean language plpgsql immutable security invoker set search_path = public as $$
declare
  zone jsonb;
  alias jsonb;
  label text;
  seen text[] := array[]::text[];
begin
  if jsonb_typeof(zones) <> 'array' then return false; end if;
  if jsonb_array_length(zones) > 40 then return false; end if;
  for zone in select value from jsonb_array_elements(zones) loop
    if jsonb_typeof(zone) <> 'object' or jsonb_typeof(zone->'name') is distinct from 'string'
      or length(trim(zone->>'name')) not between 1 and 100
      or jsonb_typeof(zone->'fee') is distinct from 'number'
      or jsonb_typeof(zone->'aliases') is distinct from 'array' then return false; end if;
    if (zone->>'fee')::numeric not between 0 and 100000
      or round((zone->>'fee')::numeric, 2) <> (zone->>'fee')::numeric
      or jsonb_array_length(zone->'aliases') > 10 then return false; end if;
    for alias in select to_jsonb(zone->>'name') union all select value from jsonb_array_elements(zone->'aliases') loop
      if jsonb_typeof(alias) is distinct from 'string' or length(alias #>> '{}') > 100 then return false; end if;
      label := trim(regexp_replace(lower(alias #>> '{}'), '[^a-z0-9؀-ۿ]+', ' ', 'g'));
      if label = '' or label = any(seen) then return false; end if;
      seen := array_append(seen, label);
    end loop;
  end loop;
  return true;
end;
$$;
alter table public.restaurant_settings drop constraint if exists restaurant_settings_delivery_pricing_check;
alter table public.restaurant_settings add constraint restaurant_settings_delivery_pricing_check check (
  delivery_pricing_mode in ('flat', 'area') and public.valid_delivery_zones(delivery_zones)
  and (delivery_pricing_mode <> 'area' or jsonb_array_length(delivery_zones) > 0)
);

create or replace function public.restaurant_priced_area_covers(address text, area text)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  destination text := trim(regexp_replace(lower(coalesce(address, '')), '[^a-z0-9؀-ۿ]+', ' ', 'g'));
  region text := trim(regexp_replace(lower(coalesce(area, '')), '[^a-z0-9؀-ۿ]+', ' ', 'g'));
  bounds text[];
  selected text[];
  prefix text;
  suffix text;
begin
  if region = '' or destination = '' then return false; end if;
  bounds := regexp_match(lower(area), '^(.*?)([0-9]+)\s*[-–]\s*([0-9]+)(.*)$');
  if bounds is null then return position(' ' || region || ' ' in ' ' || destination || ' ') > 0; end if;
  prefix := trim(regexp_replace(bounds[1], '[^a-z0-9؀-ۿ]+', ' ', 'g'));
  suffix := trim(regexp_replace(bounds[4], '[^a-z0-9؀-ۿ]+', ' ', 'g'));
  selected := regexp_match(destination, '(^| )' || replace(prefix, ' ', ' +') || ' *([0-9]+)' ||
    case when suffix = '' then '' else ' +' || replace(suffix, ' ', ' +') end || '( |$)');
  return coalesce(selected[2]::integer between bounds[2]::integer and bounds[3]::integer, false);
end;
$$;

-- One zone must match. Alias hits within the same zone count only once.
create or replace function public.restaurant_delivery_quote(p_branch_id uuid, p_address text)
returns numeric language plpgsql stable security invoker set search_path = public as $$
declare
  config public.restaurant_settings%rowtype;
  matches integer;
  fee numeric;
begin
  select * into config from public.restaurant_settings where branch_id = p_branch_id;
  if not found or not config.delivery_enabled then raise exception 'Delivery is not available for this branch.'; end if;
  if config.delivery_pricing_mode = 'flat' then return greatest(coalesce(config.delivery_fee, 0), 0); end if;
  select count(*), min((z->>'fee')::numeric) into matches, fee
  from jsonb_array_elements(config.delivery_zones) z
  where public.restaurant_priced_area_covers(p_address, z->>'name')
    or exists (select 1 from jsonb_array_elements_text(z->'aliases') a where public.restaurant_priced_area_covers(p_address, a));
  if matches = 0 then raise exception 'Delivery area is not served; confirm your exact area.'; end if;
  if matches > 1 then raise exception 'Delivery area is ambiguous; confirm your exact area.'; end if;
  return fee;
end;
$$;
revoke all on function public.restaurant_delivery_quote(uuid, text) from public, anon, authenticated;
grant execute on function public.restaurant_delivery_quote(uuid, text) to service_role;

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
language plpgsql security definer set search_path = public as $$
declare
  v_existing_order_id uuid;
  v_order_id uuid;
  v_subtotal numeric := 0;
  v_delivery_fee numeric := 0;
  v_delivery_enabled boolean := false;
  v_pricing_mode text;
  v_reviewed_fee numeric;
  v_min_delivery_amount numeric := 0;
  v_delivery_areas jsonb := '[]'::jsonb;
  v_delivery_area_count integer := 0;
  v_delivery_area_matches boolean := true;
  v_item record;
  v_menu_item record;
  v_addons jsonb;
  v_timezone text;
begin
  select coalesce(nullif(timezone, ''), 'Asia/Karachi') into v_timezone from restaurant_settings where branch_id = p_branch_id;
  v_timezone := coalesce(v_timezone, 'Asia/Karachi');
  if p_source_user_message_id is null or btrim(p_source_user_message_id) = '' then
    raise exception 'Missing source user message id for order placement.';
  end if;

  select orders.id into v_existing_order_id
  from orders where source_user_message_id = p_source_user_message_id and conversation_id = p_conversation_id and branch_id = p_branch_id limit 1;
  if v_existing_order_id is not null then
    return query select v_existing_order_id; return;
  end if;

  if p_type is null or p_type not in ('delivery', 'pickup', 'dine-in') then
    raise exception 'Invalid order type: %', p_type;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Order requires at least one item.';
  end if;
  if p_type = 'delivery' and (p_address is null or btrim(p_address) = '') then
    raise exception 'Delivery address is required.';
  end if;

  if p_type = 'delivery' then
    select coalesce(delivery_enabled, false),
           greatest(coalesce(delivery_fee, 0), 0),
           greatest(coalesce(min_delivery_amount, 0), 0),
           case when delivery_pricing_mode = 'area' then '[]'::jsonb else coalesce(delivery_areas, '[]'::jsonb) end,
           delivery_pricing_mode
      into v_delivery_enabled, v_delivery_fee, v_min_delivery_amount, v_delivery_areas, v_pricing_mode
    from restaurant_settings where branch_id = p_branch_id limit 1 for share;

    if not coalesce(v_delivery_enabled, false) then
      raise exception 'Delivery is not available for this branch.';
    end if;

    v_delivery_fee := public.restaurant_delivery_quote(p_branch_id, p_address);
    select delivery_fee_quote into v_reviewed_fee from public.conversation_states where conversation_id = p_conversation_id;
    if (v_pricing_mode = 'area' and (p_delivery_fee is distinct from v_delivery_fee or v_reviewed_fee is distinct from v_delivery_fee))
      or (v_reviewed_fee is not null and v_reviewed_fee is distinct from v_delivery_fee) then
      raise exception 'Delivery fee changed; review the order again.';
    end if;

    select count(*) into v_delivery_area_count
    from jsonb_array_elements_text(v_delivery_areas) as area(value)
    where btrim(area.value) <> '';

    if v_delivery_area_count > 0 then
      select exists (
        select 1 from jsonb_array_elements_text(v_delivery_areas) as area(value)
        where btrim(area.value) <> ''
          and (
            lower(coalesce(p_address, '')) like '%' || lower(btrim(area.value)) || '%'
            or lower(btrim(area.value)) like '%' || lower(coalesce(p_address, '')) || '%'
            or (
              select bool_and(lower(coalesce(p_address, '')) like '%' || lower(t.word) || '%')
              from regexp_split_to_table(regexp_replace(btrim(area.value), '[^a-zA-Z0-9]+', ' ', 'g'), '\s+') as t(word)
              where length(t.word) >= 3 and t.word !~ '^[0-9]+(-[0-9]+)?$'
            )
          )
      ) into v_delivery_area_matches;
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
    branch_id, conversation_id, source_user_message_id, type, subtotal, delivery_fee,
    customer_instructions, address, guests, reservation_time, pickup_time, status
  ) values (
    p_branch_id, p_conversation_id, p_source_user_message_id, p_type, 0,
    case when p_type = 'delivery' then v_delivery_fee else 0 end,
    nullif(btrim(coalesce(p_customer_instructions, '')), ''),
    case when p_type = 'delivery' then nullif(btrim(coalesce(p_address, '')), '') else null end,
    case when p_type = 'dine-in' then p_guests else null end,
    case when p_type = 'dine-in' then p_reservation_time else null end,
    case when p_type = 'pickup' then p_pickup_time else null end,
    'received'
  ) returning orders.id, orders.delivery_fee into v_order_id, v_delivery_fee;

  for v_item in
    select * from jsonb_to_recordset(p_items)
      as item(menu_item_id uuid, name text, qty integer, unit_price numeric, size text, addons jsonb, item_instructions text)
  loop
    if v_item.name is null or btrim(v_item.name) = '' then
      raise exception 'Order item name is required.';
    end if;
    if v_item.qty is null or v_item.qty < 1 or v_item.qty > 50 then
      raise exception 'Invalid quantity for %.', v_item.name;
    end if;

    select menu_items.name, menu_items.price into v_menu_item
    from menu_items
    where menu_items.branch_id = p_branch_id
      and menu_items.is_available = true
      and (
        coalesce(jsonb_array_length(menu_items.available_days), 0) = 0
        or lower(to_char(now() at time zone v_timezone, 'dy')) in (
          select lower(left(day.value, 3))
          from jsonb_array_elements_text(menu_items.available_days) as day(value)
        )
      )
      and (
        menu_items.available_start_time is null
        or menu_items.available_end_time is null
        or menu_items.available_start_time = menu_items.available_end_time
        or (menu_items.available_start_time < menu_items.available_end_time
            and to_char(now() at time zone v_timezone, 'HH24:MI') between menu_items.available_start_time and menu_items.available_end_time)
        or (menu_items.available_start_time > menu_items.available_end_time
            and (to_char(now() at time zone v_timezone, 'HH24:MI') >= menu_items.available_start_time
                 or to_char(now() at time zone v_timezone, 'HH24:MI') <= menu_items.available_end_time))
      )
      and lower(menu_items.name) = lower(v_item.name)
      and (v_item.menu_item_id is null or menu_items.id = v_item.menu_item_id)
    order by menu_items.sort_order asc, menu_items.created_at asc limit 1;

    if v_menu_item.name is null then
      raise exception 'Menu item no longer exists: %', v_item.name;
    end if;

    if v_item.unit_price is distinct from v_menu_item.price then
      raise exception 'Menu price changed; review the order again.';
    end if;

    v_addons := case when jsonb_typeof(v_item.addons) = 'array' then v_item.addons else '[]'::jsonb end;

    insert into order_items (order_id, name, qty, price, size, addons, item_instructions)
    values (v_order_id, v_menu_item.name, v_item.qty, v_menu_item.price,
            nullif(btrim(coalesce(v_item.size, '')), ''), v_addons,
            nullif(btrim(coalesce(v_item.item_instructions, '')), ''));

    v_subtotal := v_subtotal + (v_menu_item.price * v_item.qty);
  end loop;

  update orders set subtotal = v_subtotal where orders.id = v_order_id;

  if p_type = 'delivery' and v_min_delivery_amount > 0 and v_subtotal < v_min_delivery_amount then
    raise exception 'Minimum delivery order is Rs. %, current subtotal is Rs. %.', v_min_delivery_amount, v_subtotal;
  end if;

  return query select v_order_id;
exception
  when unique_violation then
    select orders.id into v_existing_order_id
    from orders where source_user_message_id = p_source_user_message_id and conversation_id = p_conversation_id and branch_id = p_branch_id limit 1;
    if v_existing_order_id is not null then
      return query select v_existing_order_id; return;
    end if;
    raise;
end;
$$;

create or replace function public.finalize_restaurant_order()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  accepted public.orders%rowtype;
  draft public.conversation_states%rowtype;
  config public.restaurant_settings%rowtype;
  local_now timestamp;
  opens time;
  closes time;
  scheduled_local timestamp;
  quoted jsonb;
  actual jsonb;
begin
  select * into accepted from public.orders where id = new.id;
  if not found or accepted.source_user_message_id is null then return new; end if;
  if not exists (select 1 from public.conversations where id = accepted.conversation_id and branch_id = accepted.branch_id) then
    raise exception 'Conversation does not belong to this branch.';
  end if;
  select * into draft from public.conversation_states where conversation_id = accepted.conversation_id for update;
  if not found or draft.stage <> 'confirming' or draft.summary_sent_at is null then
    raise exception 'A reviewed order summary is required before placement.';
  end if;
  select * into config from public.restaurant_settings where branch_id = accepted.branch_id;
  if not found or not config.is_accepting_orders then raise exception 'Restaurant is not accepting orders.'; end if;
  local_now := now() at time zone coalesce(nullif(config.timezone, ''), 'Asia/Karachi');
  opens := config.opening_time::time;
  closes := config.closing_time::time;
  if not (case when closes < opens then local_now::time >= opens or local_now::time <= closes
    else local_now::time between opens and closes end) then raise exception 'Restaurant is closed.'; end if;
  if accepted.type = 'pickup' and (accepted.pickup_time is null or accepted.pickup_time < now() - interval '1 minute') then
    raise exception 'A valid future pickup time is required.';
  end if;
  if accepted.type = 'dine-in' and (accepted.guests is null or accepted.guests not between 1 and 50
    or accepted.reservation_time is null or accepted.reservation_time < now() - interval '1 minute') then
    raise exception 'Valid guest count and future reservation time are required.';
  end if;
  scheduled_local := (case when accepted.type = 'pickup' then accepted.pickup_time
    when accepted.type = 'dine-in' then accepted.reservation_time end) at time zone coalesce(nullif(config.timezone, ''), 'Asia/Karachi');
  if scheduled_local is not null and not (case when closes < opens then scheduled_local::time >= opens or scheduled_local::time <= closes
    else scheduled_local::time between opens and closes end) then raise exception 'Scheduled time is outside restaurant hours.'; end if;
  if accepted.type = 'delivery' and (
    not config.delivery_enabled or length(trim(coalesce(accepted.address, ''))) < 8 or
    accepted.subtotal < config.min_delivery_amount or accepted.delivery_fee <> public.restaurant_delivery_quote(accepted.branch_id, accepted.address)
  ) then raise exception 'Delivery details, minimum or fee are invalid.'; end if;
  if accepted.type = 'delivery' and config.delivery_pricing_mode = 'flat' and exists (select 1 from jsonb_array_elements_text(config.delivery_areas) a where trim(a) <> '')
    and not exists (select 1 from jsonb_array_elements_text(config.delivery_areas) a where public.restaurant_delivery_area_covers(accepted.address, a)) then
    raise exception 'Delivery address is outside configured delivery areas.';
  end if;
  if accepted.type = 'delivery' and ((config.delivery_pricing_mode = 'area' and draft.delivery_fee_quote is distinct from accepted.delivery_fee)
    or (draft.delivery_fee_quote is not null and draft.delivery_fee_quote is distinct from accepted.delivery_fee)) then
    raise exception 'Delivery fee changed; review the order again.';
  end if;
  if accepted.type <> 'delivery' and accepted.delivery_fee <> 0 then raise exception 'Only delivery orders can have a delivery fee.'; end if;

  -- Compare canonical line contents, including preparation notes. A price change,
  -- missing portion or unpriced addon rolls back the whole order.
  select jsonb_agg(jsonb_build_object('name', lower(i.name), 'qty', i.qty, 'price', i.unit_price,
      'size', coalesce(i.size, ''), 'notes', coalesce(i.notes, ''), 'addons', coalesce(i.addons, '[]'::jsonb))
    order by lower(i.name), coalesce(i.size, ''), coalesce(i.notes, ''), i.qty, i.unit_price)
    into quoted from jsonb_to_recordset(draft.cart) as i(name text, qty integer, unit_price numeric, size text, notes text, addons jsonb);
  select jsonb_agg(jsonb_build_object('name', lower(i.name), 'qty', i.qty, 'price', i.price,
      'size', coalesce(i.size, ''), 'notes', coalesce(i.item_instructions, ''), 'addons', coalesce(i.addons, '[]'::jsonb))
    order by lower(i.name), coalesce(i.size, ''), coalesce(i.item_instructions, ''), i.qty, i.price)
    into actual from public.order_items i where i.order_id = accepted.id;
  if quoted is null or actual is distinct from quoted then raise exception 'Menu price or reviewed order changed; review the order again.'; end if;
  if exists (select 1 from public.order_items where order_id = accepted.id and jsonb_array_length(addons) > 0) then
    raise exception 'Priced addons require staff verification.';
  end if;
  if accepted.type is distinct from draft.order_type
    or accepted.customer_instructions is distinct from draft.customer_instructions
    or accepted.type = 'delivery' and accepted.address is distinct from draft.address
    or accepted.type = 'pickup' and accepted.pickup_time is distinct from draft.pickup_time
    or accepted.type = 'dine-in' and (accepted.guests is distinct from draft.guests or accepted.reservation_time is distinct from draft.reservation_time) then
    raise exception 'Fulfillment changed; review the order again.';
  end if;
  update public.conversation_states set stage = 'placed', cart = '[]'::jsonb, summary_sent_at = null, delivery_fee_quote = null,
    pending_clarification = null, last_shown_options = '[]'::jsonb, last_shown_options_at = null,
    last_user_whatsapp_msg_id = accepted.source_user_message_id,
    last_processed_user_message_id = accepted.source_user_message_id, updated_at = now()
    where conversation_id = accepted.conversation_id;
  return new;
end;
$$;

create or replace function public.commit_restaurant_agent_turn(p_conversation_id uuid, p_message_id uuid, p_patch jsonb)
returns boolean language plpgsql security invoker set search_path = public as $$
declare
  current_state public.conversation_states%rowtype;
  next_state public.conversation_states%rowtype;
  receipt jsonb;
begin
  select * into current_state from public.conversation_states where conversation_id = p_conversation_id for update;
  if not found then raise exception 'Conversation state not found.'; end if;
  select coalesce(metadata, '{}'::jsonb) into receipt from public.messages
    where id = p_message_id and conversation_id = p_conversation_id and role = 'user' for update;
  if not found then raise exception 'Inbound message does not belong to this conversation.'; end if;
  if receipt->>'agent_processed' = 'true' then return false; end if;
  next_state := jsonb_populate_record(null::public.conversation_states, to_jsonb(current_state) || p_patch);
  update public.conversation_states set
    stage = next_state.stage,
    resume_stage = next_state.resume_stage,
    cart = next_state.cart,
    order_type = next_state.order_type,
    address = next_state.address,
    guests = next_state.guests,
    reservation_time = next_state.reservation_time,
    pickup_time = next_state.pickup_time,
    customer_instructions = next_state.customer_instructions,
    preferred_language = next_state.preferred_language,
    last_shown_options = next_state.last_shown_options,
    last_shown_options_at = next_state.last_shown_options_at,
    last_shown_category = next_state.last_shown_category,
    pending_clarification = next_state.pending_clarification,
    upsell_item_name = next_state.upsell_item_name,
    upsell_item_price = next_state.upsell_item_price,
    upsell_offered = next_state.upsell_offered,
    declined_upsells = next_state.declined_upsells,
    summary_sent_at = next_state.summary_sent_at,
    delivery_fee_quote = case when next_state.summary_sent_at is null then null else next_state.delivery_fee_quote end,
    last_user_whatsapp_msg_id = next_state.last_user_whatsapp_msg_id,
    last_processed_user_message_id = next_state.last_processed_user_message_id,
    last_processed_message_seq = next_state.last_processed_message_seq,
    last_processed_user_message_at = next_state.last_processed_user_message_at,
    last_error = next_state.last_error,
    is_bot_active = next_state.is_bot_active,
    invalid_step_count = next_state.invalid_step_count,
    consecutive_tool_failures = next_state.consecutive_tool_failures,
    anger_level = next_state.anger_level,
    last_intent = next_state.last_intent,
    escalation_reason = next_state.escalation_reason,
    escalated_at = next_state.escalated_at,
    updated_at = now() where conversation_id = p_conversation_id;
  update public.messages set metadata = receipt || jsonb_build_object('agent_processed', true)
    where id = p_message_id and conversation_id = p_conversation_id;
  return true;
end;
$$;

-- Replacement retains existing RPC privileges and the deferred finalization trigger.
revoke all on function public.place_order_from_payload(uuid, uuid, text, text, jsonb, text, text, integer, timestamptz, timestamptz, numeric) from public, anon, authenticated;
grant execute on function public.place_order_from_payload(uuid, uuid, text, text, jsonb, text, text, integer, timestamptz, timestamptz, numeric) to service_role;

-- Health checks detect code deployed before this migration.
create or replace function public.restaurant_delivery_pricing_version()
returns text language sql stable security invoker set search_path = public as $$
  select '20261103110240'::text;
$$;
revoke all on function public.restaurant_delivery_pricing_version() from public, anon, authenticated;
grant execute on function public.restaurant_delivery_pricing_version() to service_role;
