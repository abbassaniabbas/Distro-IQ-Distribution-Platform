create extension if not exists pgcrypto;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  logo_data_url text default '',
  brand_color text not null default '#D9A21B',
  timezone text not null default 'Africa/Lagos',
  currency text not null default 'NGN',
  currency_symbol text not null default '₦',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.clients
add column if not exists brand_color text not null default '#D9A21B';

do $$ begin
  alter table public.clients
  add constraint clients_brand_color_hex
  check (brand_color ~ '^#[0-9A-Fa-f]{6}$');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  role text not null default 'sales_rep',
  status text not null default 'invited' check (status in ('invited', 'active', 'disabled')),
  password_reset_required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, email),
  unique (client_id, user_id)
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  membership_id uuid references public.memberships(id) on delete set null,
  email text not null,
  name text not null,
  role text not null default 'sales_rep',
  subject text not null,
  redirect_to text,
  status text not null default 'sent' check (status in ('ready', 'sent', 'accepted', 'revoked')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  action_type text not null,
  record_type text not null,
  record_label text not null default '',
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text not null default 'Team member',
  actor_email text not null default '',
  summary text not null default '',
  created_at timestamptz not null default now()
);

alter table public.clients enable row level security;
alter table public.memberships enable row level security;
alter table public.invites enable row level security;
alter table public.activity_logs enable row level security;

alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.invites drop constraint if exists invites_role_check;

alter table public.memberships alter column role drop default;
alter table public.invites alter column role drop default;

alter table public.memberships
alter column role type text
using role::text;

alter table public.invites
alter column role type text
using role::text;

update public.memberships
set role = case role
  when 'owner' then 'super_admin'
  when 'admin' then 'manager'
  when 'operations' then 'store_keeper'
  when 'finance' then 'accountant'
  when 'viewer' then 'ceo'
  else role
end
where role in ('owner', 'admin', 'operations', 'finance', 'viewer');

update public.invites
set role = case role
  when 'owner' then 'super_admin'
  when 'admin' then 'manager'
  when 'operations' then 'store_keeper'
  when 'finance' then 'accountant'
  when 'viewer' then 'ceo'
  else role
end
where role in ('owner', 'admin', 'operations', 'finance', 'viewer');

update public.memberships
set role = 'sales_rep'
where role not in ('sales_rep', 'manager', 'store_keeper', 'accountant', 'ceo', 'super_admin');

update public.invites
set role = 'sales_rep'
where role not in ('sales_rep', 'manager', 'store_keeper', 'accountant', 'ceo', 'super_admin');

alter table public.memberships alter column role set default 'sales_rep';
alter table public.invites alter column role set default 'sales_rep';

alter table public.memberships
add constraint memberships_role_check
check (role in ('sales_rep', 'manager', 'store_keeper', 'accountant', 'ceo', 'super_admin'));

alter table public.invites
add constraint invites_role_check
check (role in ('sales_rep', 'manager', 'store_keeper', 'accountant', 'ceo', 'super_admin'));

create or replace function public.is_client_member(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where client_id = p_client_id
      and user_id = auth.uid()
      and status in ('active', 'invited')
  );
$$;

create or replace function public.is_client_admin(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where client_id = p_client_id
      and user_id = auth.uid()
      and status = 'active'
      and role = 'super_admin'
  );
$$;

create or replace function public.create_client_workspace(
  p_company_name text,
  p_logo_data_url text,
  p_brand_color text,
  p_timezone text,
  p_currency text,
  p_currency_symbol text
)
returns public.clients
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.clients;
  v_email text;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_email := coalesce(auth.jwt() ->> 'email', '');
  v_name := coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', v_email, 'Super Admin');

  insert into public.clients (
    company_name,
    logo_data_url,
    brand_color,
    timezone,
    currency,
    currency_symbol,
    created_by
  )
  values (
    nullif(trim(p_company_name), ''),
    coalesce(p_logo_data_url, ''),
    coalesce(nullif(trim(p_brand_color), ''), '#D9A21B'),
    coalesce(nullif(trim(p_timezone), ''), 'Africa/Lagos'),
    coalesce(nullif(trim(p_currency), ''), 'NGN'),
    coalesce(nullif(trim(p_currency_symbol), ''), '₦'),
    auth.uid()
  )
  returning * into v_client;

  insert into public.memberships (
    client_id,
    user_id,
    email,
    name,
    role,
    status,
    password_reset_required
  )
  values (
    v_client.id,
    auth.uid(),
    v_email,
    v_name,
    'super_admin',
    'active',
    false
  );

  return v_client;
end;
$$;

create or replace function public.record_activity(
  p_client_id uuid,
  p_action_type text,
  p_record_type text,
  p_record_label text,
  p_summary text
)
returns public.activity_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log public.activity_logs;
  v_actor_name text;
  v_actor_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_client_member(p_client_id) then
    raise exception 'Company access required';
  end if;

  select name, email
  into v_actor_name, v_actor_email
  from public.memberships
  where client_id = p_client_id
    and user_id = auth.uid()
  order by created_at desc
  limit 1;

  v_actor_email := coalesce(v_actor_email, auth.jwt() ->> 'email', '');
  v_actor_name := coalesce(v_actor_name, auth.jwt() -> 'user_metadata' ->> 'full_name', v_actor_email, 'Team member');

  insert into public.activity_logs (
    client_id,
    action_type,
    record_type,
    record_label,
    actor_user_id,
    actor_name,
    actor_email,
    summary
  )
  values (
    p_client_id,
    nullif(trim(p_action_type), ''),
    nullif(trim(p_record_type), ''),
    coalesce(p_record_label, ''),
    auth.uid(),
    v_actor_name,
    v_actor_email,
    coalesce(p_summary, 'Record updated')
  )
  returning * into v_log;

  return v_log;
end;
$$;

create or replace function public.activate_my_membership(p_client_id uuid)
returns public.memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership public.memberships;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.memberships
  set
    status = 'active',
    password_reset_required = false
  where client_id = p_client_id
    and user_id = auth.uid()
  returning * into v_membership;

  if v_membership.id is null then
    raise exception 'Membership not found';
  end if;

  return v_membership;
end;
$$;

grant execute on function public.create_client_workspace(text, text, text, text, text, text) to authenticated;
grant execute on function public.record_activity(uuid, text, text, text, text) to authenticated;
grant execute on function public.activate_my_membership(uuid) to authenticated;
grant execute on function public.is_client_member(uuid) to authenticated;
grant execute on function public.is_client_admin(uuid) to authenticated;

drop policy if exists "clients_select_by_membership" on public.clients;
create policy "clients_select_by_membership"
on public.clients
for select
to authenticated
using (public.is_client_member(id));

drop policy if exists "clients_update_by_admin" on public.clients;
create policy "clients_update_by_admin"
on public.clients
for update
to authenticated
using (public.is_client_admin(id))
with check (public.is_client_admin(id));

drop policy if exists "memberships_select_by_client" on public.memberships;
create policy "memberships_select_by_client"
on public.memberships
for select
to authenticated
using (public.is_client_member(client_id) or user_id = auth.uid());

drop policy if exists "memberships_update_by_admin_or_self" on public.memberships;
create policy "memberships_update_by_admin_or_self"
on public.memberships
for update
to authenticated
using (public.is_client_admin(client_id) or user_id = auth.uid())
with check (public.is_client_admin(client_id) or user_id = auth.uid());

drop policy if exists "invites_select_by_admin" on public.invites;
create policy "invites_select_by_admin"
on public.invites
for select
to authenticated
using (public.is_client_admin(client_id));

drop policy if exists "invites_insert_by_admin" on public.invites;
create policy "invites_insert_by_admin"
on public.invites
for insert
to authenticated
with check (public.is_client_admin(client_id));

drop policy if exists "invites_update_by_admin" on public.invites;
create policy "invites_update_by_admin"
on public.invites
for update
to authenticated
using (public.is_client_admin(client_id))
with check (public.is_client_admin(client_id));

drop policy if exists "activity_logs_select_by_client" on public.activity_logs;
create policy "activity_logs_select_by_client"
on public.activity_logs
for select
to authenticated
using (public.is_client_member(client_id));
