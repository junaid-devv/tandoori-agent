-- Reuse the owned inbound message as a durable reply receipt. No public table
-- or client write permission is introduced. Apply after restaurant_order_integrity.
create or replace function public.commit_restaurant_agent_reply(
  p_conversation_id uuid, p_message_id uuid, p_patch jsonb, p_reply jsonb
) returns boolean language plpgsql security invoker set search_path = public as $$
begin
  if jsonb_typeof(p_reply) is distinct from 'object'
    or jsonb_typeof(p_reply->'replyText') is distinct from 'string'
    or length(btrim(p_reply->>'replyText')) = 0 then
    raise exception 'A nonempty reply is required.';
  end if;
  if not public.commit_restaurant_agent_turn(p_conversation_id, p_message_id, p_patch) then return false; end if;
  update public.messages set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'agent_reply', p_reply, 'agent_reply_status', 'ready', 'agent_reply_attempts', 0)
    where id = p_message_id and conversation_id = p_conversation_id;
  return true;
end;
$$;

create or replace function public.claim_restaurant_agent_reply(
  p_conversation_id uuid, p_message_id uuid, p_token uuid
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare result jsonb;
begin
  if p_token is null then raise exception 'A reply claim token is required.'; end if;
  update public.messages set metadata = metadata || jsonb_build_object(
    'agent_reply_status', 'sending', 'agent_reply_token', p_token,
    'agent_reply_attempts', coalesce((metadata->>'agent_reply_attempts')::integer, 0) + 1,
    'agent_reply_attempted_at', now())
    where id = p_message_id and conversation_id = p_conversation_id and role = 'user'
      and metadata->>'agent_processed' = 'true'
      and metadata->>'agent_reply_status' in ('ready', 'failed')
      and jsonb_typeof(metadata->'agent_reply') = 'object'
    returning metadata->'agent_reply' into result;
  return result;
end;
$$;

create or replace function public.finish_restaurant_agent_reply(
  p_conversation_id uuid, p_message_id uuid, p_token uuid, p_status text
) returns void language plpgsql security invoker set search_path = public as $$
begin
  if p_status is null or p_status not in ('sent', 'failed', 'uncertain') then raise exception 'Invalid reply delivery status.'; end if;
  update public.messages set metadata = metadata || jsonb_build_object(
    'agent_reply_status', p_status, 'agent_reply_finished_at', now())
    where id = p_message_id and conversation_id = p_conversation_id
      and metadata->>'agent_reply_status' = 'sending' and metadata->>'agent_reply_token' = p_token::text;
  if not found then raise exception 'Reply delivery claim is not owned by this worker.'; end if;
end;
$$;

create or replace function public.restaurant_agent_reply_version()
returns text language sql stable security invoker set search_path = public as $$ select '20261026124645'::text; $$;

revoke all on function public.commit_restaurant_agent_reply(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.claim_restaurant_agent_reply(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.finish_restaurant_agent_reply(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.restaurant_agent_reply_version() from public, anon, authenticated;
grant execute on function public.commit_restaurant_agent_reply(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.claim_restaurant_agent_reply(uuid, uuid, uuid) to service_role;
grant execute on function public.finish_restaurant_agent_reply(uuid, uuid, uuid, text) to service_role;
grant execute on function public.restaurant_agent_reply_version() to service_role;
