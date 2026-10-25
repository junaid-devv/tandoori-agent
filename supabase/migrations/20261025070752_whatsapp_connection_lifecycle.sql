-- Disconnect only the requested provider, without disabling a competing switch.
create or replace function public.disconnect_whatsapp_provider(p_restaurant_id uuid,p_provider text) returns void
language plpgsql set search_path=public,pg_temp as $$
begin
  perform 1 from public.restaurant_profiles where id=p_restaurant_id for update;
  if not found then raise exception 'Restaurant unavailable'; end if;
  if p_provider='meta' then
    update public.whatsapp_configs set is_active=false,updated_at=now() where restaurant_id=p_restaurant_id;
  elsif p_provider='evolution' then
    update public.evolution_configs set is_active=false,connection_status='close',updated_at=now() where restaurant_id=p_restaurant_id;
  else raise exception 'Invalid provider'; end if;
  update public.restaurant_profiles set whatsapp_provider='none',updated_at=now()
    where id=p_restaurant_id and whatsapp_provider=p_provider;
end $$;
revoke all on function public.disconnect_whatsapp_provider(uuid,text) from public,anon,authenticated;
grant execute on function public.disconnect_whatsapp_provider(uuid,text) to service_role;

create or replace function public.prevent_whatsapp_tenant_reassignment() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.restaurant_id is distinct from old.restaurant_id then
    raise exception 'WhatsApp connections cannot be reassigned between tenants' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.prevent_whatsapp_tenant_reassignment() from public,anon,authenticated;
create trigger prevent_meta_tenant_reassignment before update on public.whatsapp_configs for each row execute function public.prevent_whatsapp_tenant_reassignment();
create trigger prevent_evolution_tenant_reassignment before update on public.evolution_configs for each row execute function public.prevent_whatsapp_tenant_reassignment();
