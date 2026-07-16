create table if not exists public.packaging_change_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  requested_by_user_id uuid not null references auth.users(id) on delete restrict,
  requested_by_name text not null default 'Store Keeper',
  packaging_types jsonb not null default '["piece"]'::jsonb,
  packaging_defaults jsonb not null default '{"piece":1}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text not null default '',
  reviewed_by_user_id uuid references auth.users(id) on delete set null,
  reviewed_by_name text not null default '',
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create unique index if not exists packaging_change_requests_one_pending_per_user
on public.packaging_change_requests (client_id, requested_by_user_id)
where status = 'pending';

create index if not exists packaging_change_requests_client_requested_at
on public.packaging_change_requests (client_id, requested_at desc);

alter table public.packaging_change_requests enable row level security;

drop policy if exists "packaging_change_requests_select" on public.packaging_change_requests;
create policy "packaging_change_requests_select"
on public.packaging_change_requests
for select
to authenticated
using (
  public.has_client_role(client_id, array['ceo'])
  or (
    public.has_client_role(client_id, array['store_keeper'])
    and requested_by_user_id = auth.uid()
  )
);

create or replace function public.request_packaging_settings_change(
  p_client_id uuid,
  p_packaging_types text[],
  p_packaging_defaults jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_requester_name text;
  v_types text[];
  v_defaults jsonb;
begin
  if not public.has_client_role(p_client_id, array['store_keeper']) then
    raise exception 'Store Keeper access required';
  end if;

  if exists (
    select 1 from public.packaging_change_requests
    where client_id = p_client_id
      and requested_by_user_id = auth.uid()
      and status = 'pending'
  ) then
    raise exception 'A packaging change is already awaiting CEO approval';
  end if;

  select array_agg(option_name order by option_order)
  into v_types
  from (
    select value as option_name,
      case value
        when 'piece' then 1 when 'carton' then 2 when 'pack' then 3 when 'tray' then 4
        when 'pouch' then 5 when 'sachet' then 6 when 'jar' then 7 when 'display_box' then 8
      end as option_order
    from unnest(array['piece'] || coalesce(p_packaging_types, array[]::text[])) value
    where value = any(array['piece', 'carton', 'pack', 'tray', 'pouch', 'sachet', 'jar', 'display_box'])
    group by value
  ) allowed_types;

  select jsonb_object_agg(package_type, piece_count)
  into v_defaults
  from (
    select package_type,
      case when package_type = 'piece' then 1
        else greatest(1, floor(coalesce((p_packaging_defaults ->> package_type)::numeric, 1)))::integer
      end as piece_count
    from unnest(coalesce(v_types, array['piece'])) package_type
  ) configured_defaults;

  select name into v_requester_name
  from public.memberships
  where client_id = p_client_id and user_id = auth.uid() and status = 'active'
  limit 1;

  insert into public.packaging_change_requests (
    client_id,
    requested_by_user_id,
    requested_by_name,
    packaging_types,
    packaging_defaults
  ) values (
    p_client_id,
    auth.uid(),
    coalesce(v_requester_name, 'Store Keeper'),
    to_jsonb(coalesce(v_types, array['piece'])),
    coalesce(v_defaults, '{"piece":1}'::jsonb)
  ) returning id into v_request_id;

  insert into public.activity_logs (
    client_id, action_type, record_type, record_label,
    actor_user_id, actor_name, summary
  ) values (
    p_client_id, 'requested', 'packaging_settings', v_request_id::text,
    auth.uid(), coalesce(v_requester_name, 'Store Keeper'),
    coalesce(v_requester_name, 'Store Keeper') || ' requested a Sales Packaging change'
  );

  return v_request_id;
end;
$$;

create or replace function public.review_packaging_settings_change(
  p_client_id uuid,
  p_request_id uuid,
  p_decision text,
  p_review_note text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.packaging_change_requests;
  v_reviewer_name text;
begin
  if not public.has_client_role(p_client_id, array['ceo']) then
    raise exception 'CEO access required';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Choose approved or rejected';
  end if;

  if p_decision = 'rejected' and char_length(trim(coalesce(p_review_note, ''))) = 0 then
    raise exception 'A rejection reason is required';
  end if;

  select * into v_request
  from public.packaging_change_requests
  where id = p_request_id and client_id = p_client_id and status = 'pending'
  for update;

  if v_request.id is null then
    raise exception 'Pending packaging request not found';
  end if;

  select name into v_reviewer_name
  from public.memberships
  where client_id = p_client_id and user_id = auth.uid() and status = 'active'
  limit 1;

  if p_decision = 'approved' then
    update public.clients
    set packaging_types = v_request.packaging_types,
        packaging_defaults = v_request.packaging_defaults
    where id = p_client_id;
  end if;

  update public.packaging_change_requests
  set status = p_decision,
      review_note = left(trim(coalesce(p_review_note, '')), 500),
      reviewed_by_user_id = auth.uid(),
      reviewed_by_name = coalesce(v_reviewer_name, 'CEO'),
      reviewed_at = now()
  where id = p_request_id;

  insert into public.activity_logs (
    client_id, action_type, record_type, record_label,
    actor_user_id, actor_name, summary
  ) values (
    p_client_id, p_decision, 'packaging_settings', p_request_id::text,
    auth.uid(), coalesce(v_reviewer_name, 'CEO'),
    'CEO ' || p_decision || ' the Sales Packaging change requested by ' || v_request.requested_by_name
  );
end;
$$;

revoke all privileges on table public.packaging_change_requests from public, anon, authenticated;
grant select on public.packaging_change_requests to authenticated;

revoke all on function public.request_packaging_settings_change(uuid, text[], jsonb) from public, anon;
revoke all on function public.review_packaging_settings_change(uuid, uuid, text, text) from public, anon;
grant execute on function public.request_packaging_settings_change(uuid, text[], jsonb) to authenticated;
grant execute on function public.review_packaging_settings_change(uuid, uuid, text, text) to authenticated;
