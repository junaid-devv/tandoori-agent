-- Gateway compatibility is a tenant setting; native Baileys messages can be invisible
-- even after DELIVERY_ACK. Official Meta interactive messages are unaffected.
alter table public.evolution_configs add column if not exists interactive_mode text not null default 'compatible'
  check (interactive_mode in ('compatible', 'native'));
update public.restaurant_profiles set whatsapp_provider='evolution' where whatsapp_provider='wa_akg';

-- All overloads of these SECURITY DEFINER maintenance RPCs are server-only.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('replace_menu_items','apply_menu_catalog')
  loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

-- Keep an early receipt until its outbound row has acquired the provider's ID.
create table if not exists public.whatsapp_delivery_receipts (
  restaurant_id uuid not null references public.restaurant_profiles(id) on delete cascade,
  whatsapp_msg_id text not null,
  status text not null check(status in ('pending','sent','delivered','read','failed')),
  error text,
  updated_at timestamptz not null default now(),
  primary key(restaurant_id,whatsapp_msg_id)
);
alter table public.whatsapp_delivery_receipts enable row level security;
revoke all on public.whatsapp_delivery_receipts from public,anon,authenticated;
grant all on public.whatsapp_delivery_receipts to service_role;

create or replace function public.whatsapp_delivery_rank(s text) returns int
language sql immutable set search_path=public,pg_temp as $$
  select case s when 'read' then 3 when 'delivered' then 2 when 'sent' then 1 when 'failed' then 1 else 0 end
$$;

create or replace function public.record_whatsapp_delivery_status(
  p_restaurant_id uuid,p_whatsapp_id text,p_status text,p_error text default null,p_at timestamptz default now()
) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare r public.whatsapp_delivery_receipts;
begin
  if p_status not in ('sent','delivered','read','failed') then raise exception 'Invalid delivery status'; end if;
  insert into public.whatsapp_delivery_receipts as existing(restaurant_id,whatsapp_msg_id,status,error,updated_at)
    values(p_restaurant_id,p_whatsapp_id,p_status,p_error,coalesce(p_at,now()))
    on conflict(restaurant_id,whatsapp_msg_id) do update set status=excluded.status,error=excluded.error,updated_at=excluded.updated_at
    where public.whatsapp_delivery_rank(excluded.status)>public.whatsapp_delivery_rank(existing.status)
      or (public.whatsapp_delivery_rank(excluded.status)=public.whatsapp_delivery_rank(existing.status) and excluded.updated_at>=existing.updated_at);
  select * into r from public.whatsapp_delivery_receipts where restaurant_id=p_restaurant_id and whatsapp_msg_id=p_whatsapp_id;
  update public.messages m set delivery_status=r.status,delivery_error=case when r.status='failed' then r.error else null end,delivery_status_updated_at=r.updated_at
    from public.conversations c join public.contacts ct on ct.id=c.contact_id
    where m.conversation_id=c.id and ct.restaurant_id=p_restaurant_id and m.whatsapp_msg_id=p_whatsapp_id
      and m.role='assistant' and public.whatsapp_delivery_rank(m.delivery_status)<=public.whatsapp_delivery_rank(r.status);
  return jsonb_build_object('status',r.status,'error',r.error,'at',r.updated_at);
end $$;

create or replace function public.accept_outbound_message(
  p_message_id uuid,p_whatsapp_id text,p_metadata jsonb default null,p_content text default null
) returns void language plpgsql set search_path=public,pg_temp as $$
declare tenant uuid; r jsonb;
begin
  if p_whatsapp_id is null or length(p_whatsapp_id)=0 then raise exception 'Provider returned no message ID'; end if;
  select ct.restaurant_id into strict tenant from public.messages m join public.conversations c on c.id=m.conversation_id
    join public.contacts ct on ct.id=c.contact_id where m.id=p_message_id and m.role='assistant';
  -- Receipt lock comes first in both RPCs, avoiding deadlocks and lost early ACKs.
  r:=public.record_whatsapp_delivery_status(tenant,p_whatsapp_id,'sent');
  update public.messages set whatsapp_msg_id=p_whatsapp_id,
    delivery_status=case when public.whatsapp_delivery_rank(delivery_status)>public.whatsapp_delivery_rank(r->>'status') then delivery_status else r->>'status' end,
    delivery_error=case when r->>'status'='failed' then r->>'error' else null end,
    delivery_status_updated_at=(r->>'at')::timestamptz,
    metadata=case when p_metadata->>'deliveryFormat'='text_options' then (coalesce(metadata,'{}'::jsonb)-'replyButtons'-'listSelector')||p_metadata
      else coalesce(metadata,'{}'::jsonb)||coalesce(p_metadata,'{}'::jsonb) end,
    content=coalesce(p_content,content)
    where id=p_message_id and (whatsapp_msg_id is null or whatsapp_msg_id=p_whatsapp_id);
  if not found then raise exception 'Outbound message already has a different provider ID'; end if;
end $$;

revoke all on function public.whatsapp_delivery_rank(text) from public,anon,authenticated;
revoke all on function public.record_whatsapp_delivery_status(uuid,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.accept_outbound_message(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.whatsapp_delivery_rank(text),public.record_whatsapp_delivery_status(uuid,text,text,text,timestamptz),public.accept_outbound_message(uuid,text,jsonb,text) to service_role;

-- A business phone cannot route customers into two different tenants, even when
-- one connects it through Meta and the other through Evolution concurrently.
create or replace function public.enforce_whatsapp_phone_tenant() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare phone text;
begin
  if not new.is_active then return new; end if;
  if tg_table_name='evolution_configs' then
    if new.connection_status<>'open' then return new; end if;
  end if;
  phone:=regexp_replace(coalesce(new.display_phone_number,''),'[^0-9]','','g');
  if phone='' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('whatsapp-phone:'||phone,0));
  if exists(select 1 from public.whatsapp_configs where is_active and restaurant_id<>new.restaurant_id and regexp_replace(coalesce(display_phone_number,''),'[^0-9]','','g')=phone)
    or exists(select 1 from public.evolution_configs where is_active and connection_status='open' and restaurant_id<>new.restaurant_id and regexp_replace(coalesce(display_phone_number,''),'[^0-9]','','g')=phone)
  then raise exception 'This WhatsApp phone is already assigned to another restaurant' using errcode='23505'; end if;
  return new;
end $$;
revoke all on function public.enforce_whatsapp_phone_tenant() from public,anon,authenticated;
create trigger enforce_meta_phone_tenant before insert or update on public.whatsapp_configs for each row execute function public.enforce_whatsapp_phone_tenant();
create trigger enforce_evolution_phone_tenant before insert or update on public.evolution_configs for each row execute function public.enforce_whatsapp_phone_tenant();

-- Enforce ownership at the data boundary even for accidental service-role writes.
create or replace function public.enforce_tenant_relationships() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare tenant uuid; branch_tenant uuid; parent_branch uuid;
begin
  if tg_table_name='contacts' then
    if new.active_branch_id is null then return new; end if;
    select restaurant_id into branch_tenant from public.branches where id=new.active_branch_id;
    tenant:=new.restaurant_id;
  elsif tg_table_name='conversations' then
    select restaurant_id into tenant from public.contacts where id=new.contact_id;
    select restaurant_id into branch_tenant from public.branches where id=new.branch_id;
  elsif tg_table_name='staff_profiles' then
    if new.default_branch_id is null then return new; end if;
    tenant:=new.restaurant_id;
    select restaurant_id into branch_tenant from public.branches where id=new.default_branch_id;
  elsif tg_table_name='staff_branch_access' then
    select restaurant_id into tenant from public.staff_profiles where user_id=new.user_id;
    select restaurant_id into branch_tenant from public.branches where id=new.branch_id;
  elsif tg_table_name='orders' then
    select branch_id into parent_branch from public.conversations where id=new.conversation_id;
    if parent_branch is distinct from new.branch_id then raise exception 'Order and conversation branches differ' using errcode='23514'; end if;
    return new;
  end if;
  if tenant is null or branch_tenant is null or tenant is distinct from branch_tenant then
    raise exception 'Cross-tenant relationship rejected' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.enforce_tenant_relationships() from public,anon,authenticated;
create trigger enforce_contact_tenant before insert or update on public.contacts for each row execute function public.enforce_tenant_relationships();
create trigger enforce_conversation_tenant before insert or update on public.conversations for each row execute function public.enforce_tenant_relationships();
create trigger enforce_staff_tenant before insert or update on public.staff_profiles for each row execute function public.enforce_tenant_relationships();
create trigger enforce_staff_access_tenant before insert or update on public.staff_branch_access for each row execute function public.enforce_tenant_relationships();
create trigger enforce_order_tenant before insert or update on public.orders for each row execute function public.enforce_tenant_relationships();

-- Activation is serialized with onboarding for this tenant, with DB readiness checks.
create or replace function public.switch_whatsapp_provider(p_restaurant_id uuid,p_provider text) returns void
language plpgsql set search_path=public,pg_temp as $$
begin
  perform 1 from public.restaurant_profiles where id=p_restaurant_id and is_active for update;
  if not found then raise exception 'Restaurant unavailable'; end if;
  if p_provider='evolution' then
    if not exists(select 1 from public.evolution_configs where restaurant_id=p_restaurant_id and is_active and connection_status='open' and instance_name='orderiq-'||p_restaurant_id::text) then raise exception 'Connect Evolution first'; end if;
  elsif p_provider='meta' then
    if not exists(select 1 from public.whatsapp_configs where restaurant_id=p_restaurant_id and is_active and length(access_token)>0) then raise exception 'Connect Meta first'; end if;
  elsif p_provider<>'none' then raise exception 'Invalid provider'; end if;
  update public.restaurant_profiles set whatsapp_provider=p_provider,updated_at=now() where id=p_restaurant_id;
end $$;
revoke all on function public.switch_whatsapp_provider(uuid,text) from public,anon,authenticated;
grant execute on function public.switch_whatsapp_provider(uuid,text) to service_role;

create or replace function public.connect_meta_whatsapp(p_restaurant_id uuid,p_phone_id text,p_waba_id text,p_token text,p_phone text,p_name text) returns void
language plpgsql set search_path=public,pg_temp as $$
begin
  perform 1 from public.restaurant_profiles where id=p_restaurant_id and is_active for update;
  if not found then raise exception 'Restaurant unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended('meta-id:'||p_phone_id,0));
  if exists(select 1 from public.whatsapp_configs where phone_number_id=p_phone_id and restaurant_id<>p_restaurant_id) then
    raise exception 'This WhatsApp phone is already assigned to another restaurant' using errcode='23505';
  end if;
  update public.whatsapp_configs set is_active=false,updated_at=now() where restaurant_id=p_restaurant_id and phone_number_id<>p_phone_id;
  insert into public.whatsapp_configs(restaurant_id,phone_number_id,waba_id,access_token,display_phone_number,verified_name,is_active,updated_at)
    values(p_restaurant_id,p_phone_id,p_waba_id,p_token,p_phone,p_name,true,now())
    on conflict(phone_number_id) do update set waba_id=excluded.waba_id,access_token=excluded.access_token,display_phone_number=excluded.display_phone_number,verified_name=excluded.verified_name,is_active=true,updated_at=now()
    where whatsapp_configs.restaurant_id=p_restaurant_id;
  perform public.switch_whatsapp_provider(p_restaurant_id,'meta');
end $$;
revoke all on function public.connect_meta_whatsapp(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.connect_meta_whatsapp(uuid,text,text,text,text,text) to service_role;

-- Pin the trigger helper's search path as recommended by the security advisor.
alter function public.update_updated_at_column() set search_path=public,pg_temp;
