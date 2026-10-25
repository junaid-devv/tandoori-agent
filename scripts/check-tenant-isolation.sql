-- Run against the migrated database. All test rows are rolled back.
begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); ba uuid; bb uuid; ca uuid; cb uuid; va uuid; vb uuid; ma uuid; mb uuid; n int;
begin
  insert into restaurant_profiles(id,name,slug) values(a,'Isolation fixture A',a::text),(b,'Isolation fixture B',b::text);
  insert into branches(restaurant_id,name,slug) values(a,'Branch A',a::text) returning id into ba;
  insert into branches(restaurant_id,name,slug) values(b,'Branch B',b::text) returning id into bb;
  insert into contacts(restaurant_id,phone,active_branch_id) values(a,'19990000001',ba) returning id into ca;
  insert into contacts(restaurant_id,phone,active_branch_id) values(b,'19990000001',bb) returning id into cb;
  begin
    insert into conversations(contact_id,branch_id,phone) values(ca,bb,'19990000001');
    raise exception 'FAIL: cross-tenant conversation accepted';
  exception when check_violation then null; end;
  begin
    update contacts set active_branch_id=bb where id=ca;
    raise exception 'FAIL: cross-tenant contact branch accepted';
  exception when check_violation then null; end;
  insert into conversations(contact_id,branch_id,phone) values(ca,ba,'19990000001') returning id into va;
  insert into conversations(contact_id,branch_id,phone) values(cb,bb,'19990000001') returning id into vb;
  insert into messages(conversation_id,role,sender_kind,content,delivery_status) values(va,'assistant','ai','test','pending') returning id into ma;
  insert into messages(conversation_id,role,sender_kind,content,whatsapp_msg_id,delivery_status) values(vb,'assistant','ai','test','fixture-shared-id','sent') returning id into mb;
  perform record_whatsapp_delivery_status(a,'fixture-shared-id','read');
  perform record_whatsapp_delivery_status(a,'fixture-a-id','read');
  perform accept_outbound_message(ma,'fixture-a-id','{"deliveryFormat":"text_options"}','1. Menu');
  if (select delivery_status from messages where id=ma)<>'read' then raise exception 'FAIL: early receipt lost'; end if;
  if (select delivery_status from messages where id=mb)<>'sent' then raise exception 'FAIL: receipt leaked into tenant B'; end if;
  perform record_whatsapp_delivery_status(a,'fixture-a-id','sent');
  perform record_whatsapp_delivery_status(a,'fixture-a-id','failed');
  if (select delivery_status from messages where id=ma)<>'read' then raise exception 'FAIL: receipt downgraded'; end if;
  begin
    perform switch_whatsapp_provider(a,'evolution');
    raise exception 'FAIL: disconnected provider activated';
  exception when raise_exception then
    if sqlerrm not like 'Connect Evolution first%' then raise; end if;
  end;
  insert into evolution_configs(restaurant_id,instance_name,is_active,connection_status,display_phone_number)
    values(a,'orderiq-'||a::text,true,'open','19990000002');
  perform switch_whatsapp_provider(a,'evolution');
  if (select whatsapp_provider from restaurant_profiles where id=a)<>'evolution' then raise exception 'FAIL: ready provider could not activate'; end if;
  begin
    perform connect_meta_whatsapp(b,'fixture-phone','fixture-waba','fixture-token','19990000002','B');
    raise exception 'FAIL: shared phone assigned to tenant B';
  exception when unique_violation then null; end;
  perform connect_meta_whatsapp(a,'fixture-phone','fixture-waba','fixture-token','19990000002','A');
  perform disconnect_whatsapp_provider(a,'evolution');
  if (select whatsapp_provider from restaurant_profiles where id=a)<>'meta' then raise exception 'FAIL: inactive provider disconnect disabled Meta'; end if;
  update evolution_configs set is_active=true,connection_status='open' where restaurant_id=a;
  perform switch_whatsapp_provider(a,'evolution');
  perform disconnect_whatsapp_provider(a,'meta');
  if (select whatsapp_provider from restaurant_profiles where id=a)<>'evolution' then raise exception 'FAIL: inactive provider disconnect disabled Evolution'; end if;
  begin
    update evolution_configs set restaurant_id=b,display_phone_number='19990000004' where restaurant_id=a;
    raise exception 'FAIL: Evolution tenant reassignment accepted';
  exception when check_violation then null; end;
  begin
    perform connect_meta_whatsapp(b,'fixture-phone','fixture-waba','fixture-token','19990000003','B');
    raise exception 'FAIL: Meta phone reassigned';
  exception when unique_violation then null; end;
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and p.proname in ('replace_menu_items','apply_menu_catalog','connect_meta_whatsapp','disconnect_whatsapp_provider','switch_whatsapp_provider','accept_outbound_message','record_whatsapp_delivery_status')
      and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'));
  if n<>0 then raise exception 'FAIL: privileged RPC publicly callable'; end if;
end $$;
rollback;
select 'PASS: tenant relationships, shared-phone conflicts, provider readiness, early receipts, monotonic delivery and RPC privileges (fixtures rolled back)' as result;
