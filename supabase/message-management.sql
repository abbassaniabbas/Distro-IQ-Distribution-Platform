-- Per-user message deletion, conversation clearing, and sender-only unsend.
-- Run this once for an existing Supabase project.

create table if not exists public.workspace_message_deletions (
  client_id uuid not null references public.clients(id) on delete cascade,
  message_id uuid not null references public.workspace_messages(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  deleted_at timestamptz not null default now(),
  primary key (message_id, membership_id)
);

create index if not exists workspace_message_deletions_member_idx
on public.workspace_message_deletions (client_id, membership_id, deleted_at desc);

alter table public.workspace_message_deletions enable row level security;
revoke all privileges on table public.workspace_message_deletions from public, anon, authenticated;

create or replace function public.get_my_workspace_messages(p_client_id uuid)
returns table (
  id uuid,
  client_id uuid,
  from_account_id uuid,
  from_user_id uuid,
  from_name text,
  from_email text,
  from_role text,
  to_account_id uuid,
  to_user_id uuid,
  to_name text,
  to_email text,
  to_role text,
  body text,
  audience text,
  read_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_membership_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select memberships.id
  into v_current_membership_id
  from public.memberships
  where memberships.client_id = p_client_id
    and memberships.user_id = auth.uid()
    and memberships.status = 'active'
    and not memberships.password_reset_required
  limit 1;

  if v_current_membership_id is null then
    raise exception 'Company access required';
  end if;

  return query
  select
    messages.id,
    messages.client_id,
    sender.id,
    sender.user_id,
    sender.name,
    sender.email,
    sender.role,
    recipient.id,
    recipient.user_id,
    recipient.name,
    recipient.email,
    recipient.role,
    messages.body,
    messages.audience,
    messages.read_at,
    messages.created_at
  from public.workspace_messages messages
  join public.memberships sender on sender.id = messages.from_membership_id
  join public.memberships recipient on recipient.id = messages.to_membership_id
  where messages.client_id = p_client_id
    and (
      messages.from_membership_id = v_current_membership_id
      or messages.to_membership_id = v_current_membership_id
    )
    and not exists (
      select 1
      from public.workspace_message_deletions deletions
      where deletions.message_id = messages.id
        and deletions.membership_id = v_current_membership_id
    )
  order by messages.created_at asc;
end;
$$;

create or replace function public.delete_my_workspace_messages(
  p_client_id uuid,
  p_message_ids uuid[],
  p_unsend boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_membership_id uuid;
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select memberships.id
  into v_current_membership_id
  from public.memberships
  where memberships.client_id = p_client_id
    and memberships.user_id = auth.uid()
    and memberships.status = 'active'
    and not memberships.password_reset_required
  limit 1;

  if v_current_membership_id is null then
    raise exception 'Company access required';
  end if;

  if coalesce(array_length(p_message_ids, 1), 0) = 0 then
    raise exception 'Choose a message';
  end if;

  if p_unsend then
    delete from public.workspace_messages messages
    where messages.client_id = p_client_id
      and messages.id = any(p_message_ids)
      and messages.from_membership_id = v_current_membership_id;
    get diagnostics v_count = row_count;
    return v_count;
  end if;

  insert into public.workspace_message_deletions (client_id, message_id, membership_id)
  select p_client_id, messages.id, v_current_membership_id
  from public.workspace_messages messages
  where messages.client_id = p_client_id
    and messages.id = any(p_message_ids)
    and (
      messages.from_membership_id = v_current_membership_id
      or messages.to_membership_id = v_current_membership_id
    )
  on conflict (message_id, membership_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.clear_my_workspace_conversation(
  p_client_id uuid,
  p_peer_membership_id uuid default null,
  p_audience text default 'direct'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_membership_id uuid;
  v_audience text := lower(trim(coalesce(p_audience, 'direct')));
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select memberships.id
  into v_current_membership_id
  from public.memberships
  where memberships.client_id = p_client_id
    and memberships.user_id = auth.uid()
    and memberships.status = 'active'
    and not memberships.password_reset_required
  limit 1;

  if v_current_membership_id is null then
    raise exception 'Company access required';
  end if;

  if v_audience not in ('direct', 'all_staff') then
    raise exception 'Invalid conversation';
  end if;

  if v_audience = 'direct' and not exists (
    select 1
    from public.memberships peer
    where peer.id = p_peer_membership_id
      and peer.client_id = p_client_id
      and peer.id <> v_current_membership_id
  ) then
    raise exception 'The selected conversation is not available';
  end if;

  insert into public.workspace_message_deletions (client_id, message_id, membership_id)
  select p_client_id, messages.id, v_current_membership_id
  from public.workspace_messages messages
  where messages.client_id = p_client_id
    and (
      (
        v_audience = 'all_staff'
        and messages.audience = 'all_staff'
        and messages.from_membership_id = v_current_membership_id
      )
      or
      (
        v_audience = 'direct'
        and (
          (
            messages.from_membership_id = v_current_membership_id
            and messages.to_membership_id = p_peer_membership_id
          )
          or
          (
            messages.from_membership_id = p_peer_membership_id
            and messages.to_membership_id = v_current_membership_id
          )
        )
      )
    )
  on conflict (message_id, membership_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.delete_my_workspace_messages(uuid, uuid[], boolean) from public, anon, authenticated;
revoke all on function public.clear_my_workspace_conversation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.get_my_workspace_messages(uuid) to authenticated;
grant execute on function public.delete_my_workspace_messages(uuid, uuid[], boolean) to authenticated;
grant execute on function public.clear_my_workspace_conversation(uuid, uuid, text) to authenticated;
