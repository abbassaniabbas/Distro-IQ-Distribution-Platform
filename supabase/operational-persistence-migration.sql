-- Central persistence for every operational record currently managed by the
-- browser reducer. Records are stored separately so concurrent changes to
-- unrelated entities do not overwrite an entire workspace snapshot.

create table if not exists public.workspace_operational_records (
  client_id uuid not null references public.clients(id) on delete cascade,
  collection_name text not null,
  record_id text not null,
  record_data jsonb not null check (jsonb_typeof(record_data) = 'object'),
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (client_id, collection_name, record_id)
);

create table if not exists public.workspace_operational_collections (
  client_id uuid not null references public.clients(id) on delete cascade,
  collection_name text not null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (client_id, collection_name)
);

create table if not exists public.workspace_operation_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  operation_id text not null,
  action_type text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text not null default 'Team member',
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (client_id, operation_id)
);

create index if not exists workspace_operational_records_updated_idx
on public.workspace_operational_records (client_id, updated_at desc);

create index if not exists workspace_operation_events_created_idx
on public.workspace_operation_events (client_id, created_at desc);

alter table public.workspace_operational_records enable row level security;
alter table public.workspace_operational_collections enable row level security;
alter table public.workspace_operation_events enable row level security;

drop policy if exists "workspace_operational_records_select" on public.workspace_operational_records;
create policy "workspace_operational_records_select"
on public.workspace_operational_records
for select
to authenticated
using (public.is_client_member(client_id));

drop policy if exists "workspace_operational_collections_select" on public.workspace_operational_collections;
create policy "workspace_operational_collections_select"
on public.workspace_operational_collections
for select
to authenticated
using (public.is_client_member(client_id));

drop policy if exists "workspace_operation_events_select" on public.workspace_operation_events;
create policy "workspace_operation_events_select"
on public.workspace_operation_events
for select
to authenticated
using (public.has_client_role(client_id, array['ceo', 'admin']));

revoke all privileges on public.workspace_operational_records from public, anon, authenticated;
revoke all privileges on public.workspace_operational_collections from public, anon, authenticated;
revoke all privileges on public.workspace_operation_events from public, anon, authenticated;
grant select on public.workspace_operational_records to authenticated;
grant select on public.workspace_operational_collections to authenticated;
grant select on public.workspace_operation_events to authenticated;

create or replace function public.sync_workspace_operational_records(
  p_client_id uuid,
  p_operation_id text,
  p_action_type text,
  p_records jsonb default '[]'::jsonb,
  p_deleted jsonb default '[]'::jsonb,
  p_touched_collections jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_actor_name text;
  v_item jsonb;
  v_collection text;
  v_record_id text;
  v_allowed_collections text[];
  v_inserted_event uuid;
  v_saved_count integer := 0;
  v_deleted_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select case when m.role = 'manager' then 'ceo' else m.role end, m.name
  into v_role, v_actor_name
  from public.memberships m
  where m.client_id = p_client_id
    and m.user_id = auth.uid()
    and m.status = 'active'
    and not m.password_reset_required
  limit 1;

  if v_role is null then
    raise exception 'Active company access required';
  end if;

  if char_length(trim(coalesce(p_operation_id, ''))) < 8
    or char_length(trim(coalesce(p_action_type, ''))) < 2 then
    raise exception 'A valid operation identifier and action type are required';
  end if;

  if jsonb_typeof(coalesce(p_records, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_deleted, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_touched_collections, '[]'::jsonb)) <> 'array' then
    raise exception 'Operational changes must be JSON arrays';
  end if;

  v_allowed_collections := case v_role
    when 'ceo' then array[
      'products', 'stockCategories', 'stockAssignments', 'stockTransactions',
      'productionBatches', 'retailers', 'orders', 'invoices', 'salesReports',
      'correctionRequests', 'stockRequests', 'purchaseOrders', 'procurementOrders',
      'routes', 'creditLimits', 'creditLimitHistory', 'activityLogs'
    ]
    when 'admin' then array[
      'products', 'stockAssignments', 'stockTransactions', 'retailers', 'orders',
      'invoices', 'salesReports', 'correctionRequests', 'stockRequests',
      'purchaseOrders', 'procurementOrders', 'routes', 'creditLimits',
      'creditLimitHistory', 'activityLogs'
    ]
    when 'store_keeper' then array[
      'products', 'stockCategories', 'stockAssignments', 'stockTransactions',
      'productionBatches', 'orders', 'invoices', 'correctionRequests',
      'stockRequests', 'purchaseOrders', 'procurementOrders', 'routes', 'activityLogs'
    ]
    when 'sales_rep' then array[
      'stockAssignments', 'stockTransactions', 'retailers', 'orders', 'invoices',
      'salesReports', 'correctionRequests', 'stockRequests', 'routes',
      'creditLimits', 'activityLogs'
    ]
    else array[]::text[]
  end;

  if coalesce(array_length(v_allowed_collections, 1), 0) = 0 then
    raise exception 'This role cannot synchronize operational data';
  end if;

  insert into public.workspace_operation_events (
    client_id, operation_id, action_type, actor_user_id, actor_name, changes
  ) values (
    p_client_id,
    trim(p_operation_id),
    left(trim(p_action_type), 120),
    auth.uid(),
    coalesce(nullif(trim(v_actor_name), ''), 'Team member'),
    jsonb_build_object(
      'records', coalesce(p_records, '[]'::jsonb),
      'deleted', coalesce(p_deleted, '[]'::jsonb),
      'touchedCollections', coalesce(p_touched_collections, '[]'::jsonb)
    )
  )
  on conflict (client_id, operation_id) do nothing
  returning id into v_inserted_event;

  if v_inserted_event is null then
    return jsonb_build_object('duplicate', true, 'saved', 0, 'deleted', 0);
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_touched_collections, '[]'::jsonb))
  loop
    v_collection := trim(both '"' from v_item::text);
    if not (v_collection = any(v_allowed_collections)) then
      raise exception 'Role % cannot synchronize collection %', v_role, v_collection;
    end if;

    insert into public.workspace_operational_collections (
      client_id, collection_name, updated_by_user_id, updated_at
    ) values (
      p_client_id, v_collection, auth.uid(), now()
    )
    on conflict (client_id, collection_name) do update
    set updated_by_user_id = excluded.updated_by_user_id,
        updated_at = excluded.updated_at;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_records, '[]'::jsonb))
  loop
    v_collection := trim(coalesce(v_item ->> 'collection', ''));
    v_record_id := trim(coalesce(v_item ->> 'id', ''));

    if not (v_collection = any(v_allowed_collections)) then
      raise exception 'Role % cannot synchronize collection %', v_role, v_collection;
    end if;
    if v_record_id = '' or jsonb_typeof(v_item -> 'data') <> 'object' then
      raise exception 'Every operational record requires an id and object data';
    end if;

    insert into public.workspace_operational_records (
      client_id, collection_name, record_id, record_data,
      updated_by_user_id, updated_at
    ) values (
      p_client_id, v_collection, left(v_record_id, 240), v_item -> 'data',
      auth.uid(), now()
    )
    on conflict (client_id, collection_name, record_id) do update
    set record_data = excluded.record_data,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = excluded.updated_at;
    v_saved_count := v_saved_count + 1;
  end loop;

  if jsonb_array_length(coalesce(p_deleted, '[]'::jsonb)) > 0 and v_role <> 'ceo' then
    raise exception 'Only the CEO can permanently delete operational records';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_deleted, '[]'::jsonb))
  loop
    v_collection := trim(coalesce(v_item ->> 'collection', ''));
    v_record_id := trim(coalesce(v_item ->> 'id', ''));
    if not (v_collection = any(v_allowed_collections)) or v_record_id = '' then
      raise exception 'Invalid operational record deletion';
    end if;

    delete from public.workspace_operational_records
    where client_id = p_client_id
      and collection_name = v_collection
      and record_id = v_record_id;
    v_deleted_count := v_deleted_count + 1;
  end loop;

  return jsonb_build_object(
    'duplicate', false,
    'saved', v_saved_count,
    'deleted', v_deleted_count,
    'eventId', v_inserted_event
  );
end;
$$;

revoke all on function public.sync_workspace_operational_records(uuid, text, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.sync_workspace_operational_records(uuid, text, text, jsonb, jsonb, jsonb) to authenticated;
