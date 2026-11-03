-- Match chat quotes and final order validation with the same conservative rules.
create or replace function public.restaurant_delivery_area_normalize(value text)
returns text language sql immutable security invoker set search_path = public as $$
  select trim(regexp_replace(lower(
    translate(regexp_replace(translate(coalesce(value, ''),
      '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), '[ً-ٰٟـ]', '', 'g'), 'يىك', 'ییک')
  ), '[^a-z0-9؀-ۿ]+', ' ', 'g'));
$$;

create or replace function public.restaurant_area_within_typo_limit(a text, b text, max_edits integer)
returns boolean language plpgsql immutable security invoker set search_path = public as $$
declare
  previous integer[] := array[]::integer[];
  before_previous integer[];
  current_row integer[];
  i integer;
  j integer;
begin
  if abs(length(a) - length(b)) > max_edits then return false; end if;
  previous := array[0];
  for j in 1..length(b) loop
    previous := array_append(previous, previous[j] + case when substr(b, j, 1) ~ '[0-9]' then 10000 else 1 end);
  end loop;
  before_previous := previous;
  for i in 1..length(a) loop
    current_row := array[previous[1] + case when substr(a, i, 1) ~ '[0-9]' then 10000 else 1 end];
    for j in 1..length(b) loop
      current_row[j + 1] := least(
        current_row[j] + case when substr(b, j, 1) ~ '[0-9]' then 10000 else 1 end,
        previous[j + 1] + case when substr(a, i, 1) ~ '[0-9]' then 10000 else 1 end,
        previous[j] + case when substr(a, i, 1) = substr(b, j, 1) then 0
          when substr(a, i, 1) ~ '[0-9]' or substr(b, j, 1) ~ '[0-9]' then 10000 else 1 end);
      if i > 1 and j > 1 and substr(a, i - 1, 2) !~ '[0-9]' and substr(a, i, 1) = substr(b, j - 1, 1)
        and substr(a, i - 1, 1) = substr(b, j, 1) then
        current_row[j + 1] := least(current_row[j + 1], before_previous[j - 1] + 1);
      end if;
    end loop;
    before_previous := previous;
    previous := current_row;
  end loop;
  return previous[length(b) + 1] <= max_edits;
end;
$$;

create or replace function public.restaurant_area_spelling_matches(address text, area text, allow_typos boolean)
returns boolean language plpgsql immutable security invoker set search_path = public as $$
declare
  words text[] := string_to_array(left(public.restaurant_delivery_area_normalize(address), 2000), ' ');
  region text := public.restaurant_delivery_area_normalize(area);
  target text := replace(region, ' ', '');
  target_numbers text := trim(both ',' from regexp_replace(target, '[^0-9]+', ',', 'g'));
  candidate text;
  max_edits integer := 0;
  max_words integer := cardinality(string_to_array(region, ' ')) + 1;
  start_at integer;
  word_count integer;
begin
  if region = '' or area ~ '[0-9]+\s*[-–]\s*[0-9]+' then return false; end if;
  if allow_typos and target ~ '^[a-z0-9]+$' and length(target) >= 5 then
    max_edits := case when length(target) >= 10 then 2 else 1 end;
  end if;
  for start_at in 1..coalesce(cardinality(words), 0) loop
    if target ~ '^[0-9]' and start_at > 1 and words[start_at - 1]
      ~ '^(house|h|flat|apartment|apt|plot|street|st|gali|makan|makaan|ghar|shop|room|gate|گھر|مکان|گلی|دکان)$' then continue; end if;
    candidate := '';
    for word_count in 1..least(max_words, cardinality(words) - start_at + 1) loop
      candidate := candidate || words[start_at + word_count - 1];
      -- Spelling correction must never change phase/barrier/area numbers.
      if trim(both ',' from regexp_replace(candidate, '[^0-9]+', ',', 'g')) <> target_numbers then continue; end if;
      if candidate = target or (max_edits > 0 and public.restaurant_area_within_typo_limit(candidate, target, max_edits)) then
        return true;
      end if;
    end loop;
  end loop;
  return false;
end;
$$;

create or replace function public.restaurant_priced_area_covers(address text, area text)
returns boolean language plpgsql immutable security invoker set search_path = public as $$
declare
  destination text := public.restaurant_delivery_area_normalize(address);
  region text := public.restaurant_delivery_area_normalize(area);
  bounds text[];
  selected text[];
  prefix text;
  suffix text;
begin
  if region = '' or destination = '' then return false; end if;
  bounds := regexp_match(lower(area), '^(.*?)([0-9]+)\s*[-–]\s*([0-9]+)(.*)$');
  if bounds is null then
    return (region !~ '^[0-9]' and position(' ' || region || ' ' in ' ' || destination || ' ') > 0)
      or public.restaurant_area_spelling_matches(address, area, false);
  end if;
  prefix := trim(regexp_replace(bounds[1], '[^a-z0-9؀-ۿ]+', ' ', 'g'));
  suffix := trim(regexp_replace(bounds[4], '[^a-z0-9؀-ۿ]+', ' ', 'g'));
  selected := regexp_match(destination, '(^| )' || replace(prefix, ' ', ' +') || ' *([0-9]+)' ||
    case when suffix = '' then '' else ' +' || replace(suffix, ' ', ' +') end || '( |$)');
  return coalesce(selected[2]::integer between bounds[2]::integer and bounds[3]::integer, false);
end;
$$;

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
  -- Exact names and aliases win over approximate spelling matches.
  if matches = 0 then
    select count(*), min((z->>'fee')::numeric) into matches, fee
    from jsonb_array_elements(config.delivery_zones) z
    where public.restaurant_area_spelling_matches(p_address, z->>'name', true)
      or exists (select 1 from jsonb_array_elements_text(z->'aliases') a where public.restaurant_area_spelling_matches(p_address, a, true));
  end if;
  if matches = 0 then raise exception 'Delivery area is not served; confirm your exact area.'; end if;
  if matches > 1 then raise exception 'Delivery area is ambiguous; confirm your exact area.'; end if;
  return fee;
end;
$$;

revoke all on function public.restaurant_delivery_area_normalize(text),
  public.restaurant_area_within_typo_limit(text, text, integer),
  public.restaurant_area_spelling_matches(text, text, boolean) from public, anon, authenticated;
grant execute on function public.restaurant_delivery_area_normalize(text),
  public.restaurant_area_within_typo_limit(text, text, integer),
  public.restaurant_area_spelling_matches(text, text, boolean) to service_role;
revoke all on function public.restaurant_delivery_quote(uuid, text) from public, anon, authenticated;
grant execute on function public.restaurant_delivery_quote(uuid, text) to service_role;
