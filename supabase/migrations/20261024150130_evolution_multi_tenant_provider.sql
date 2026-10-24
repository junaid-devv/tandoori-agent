-- Add Evolution alongside Meta without changing a live tenant's selected provider.
-- wa_akg is accepted temporarily for deployments still running the previous release.
-- New application code cannot select it and contains no legacy gateway transport.
alter table public.restaurant_profiles drop constraint if exists restaurant_profiles_whatsapp_provider_check;
alter table public.restaurant_profiles add constraint restaurant_profiles_whatsapp_provider_check
  check (whatsapp_provider in ('meta', 'evolution', 'none', 'wa_akg'));

create table public.evolution_configs (
  restaurant_id uuid primary key references public.restaurant_profiles(id) on delete cascade,
  instance_name text not null unique check (instance_name = 'orderiq-' || restaurant_id::text),
  is_active boolean not null default false,
  connection_status text not null default 'close',
  display_phone_number text,
  verified_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only the server service role can read or mutate connection records. The dashboard
-- accesses these through authenticated, tenant-authorized Next.js endpoints.
alter table public.evolution_configs enable row level security;
revoke all on table public.evolution_configs from public, anon, authenticated;
grant select, insert, update, delete on table public.evolution_configs to service_role;

alter table public.conversations
  add column whatsapp_provider text check (whatsapp_provider in ('meta', 'evolution')),
  add column whatsapp_phone_number_id text,
  add column evolution_instance_name text;

comment on column public.conversations.whatsapp_provider is 'Inbound channel used for dashboard replies and customer order notifications.';
comment on table public.evolution_configs is 'One deterministic Evolution instance per tenant. Gateway credentials stay in server environment variables.';

-- Keep provider and tenant identities unambiguous even when different gateway
-- instances receive identical raw Baileys message IDs. Evolution IDs are prefixed
-- in application code; Meta message IDs remain unchanged for compatibility.
create index conversations_evolution_instance_idx on public.conversations(evolution_instance_name)
  where evolution_instance_name is not null;

notify pgrst, 'reload schema';
