-- CEO-only operational data clearing. Company identity, staff memberships,
-- authentication users, messages, and factory settings are deliberately kept.

create or replace function public.reset_workspace_data(
  p_client_id uuid,
  p_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_scope text := lower(trim(coalesce(p_scope, '')));
  v_user_id uuid := auth.uid();
  v_deleted integer := 0;
  v_count integer := 0;
  v_marker_id text := 'ACTIVITY-RESET-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text;
  v_collections text[] := array[
    'products', 'stockCategories', 'stockAssignments', 'stockTransactions',
    'productionBatches', 'retailers', 'orders', 'invoices', 'salesReports',
    'correctionRequests', 'stockRequests', 'purchaseOrders', 'procurementOrders',
    'routes', 'creditLimits', 'creditLimitHistory', 'activityLogs'
  ];
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select case when role = 'manager' then 'ceo' else role end
  into v_role
  from public.memberships
  where client_id = p_client_id
    and user_id = v_user_id
    and status = 'active'
    and not password_reset_required
  limit 1;

  if v_role <> 'ceo' then
    raise exception 'Only the CEO can clear company data';
  end if;
  if v_scope not in ('adjustments', 'customers', 'finance', 'activity', 'factory') then
    raise exception 'Unsupported data reset scope';
  end if;

  if v_scope in ('finance', 'factory') then
    delete from public.credit_limit_history where client_id = p_client_id;
    get diagnostics v_count = row_count;
    v_deleted := v_deleted + v_count;

    delete from public.credit_limits where client_id = p_client_id;
    get diagnostics v_count = row_count;
    v_deleted := v_deleted + v_count;
  end if;

  if v_scope in ('activity', 'factory') then
    delete from public.activity_logs where client_id = p_client_id;
    get diagnostics v_count = row_count;
    v_deleted := v_deleted + v_count;
  end if;

  if v_scope = 'adjustments' then
    delete from public.workspace_operational_records
    where client_id = p_client_id and collection_name = 'correctionRequests';
  elsif v_scope = 'customers' then
    delete from public.workspace_operational_records
    where client_id = p_client_id and collection_name = 'retailers';
  elsif v_scope = 'finance' then
    delete from public.workspace_operational_records
    where client_id = p_client_id
      and (
        collection_name in ('invoices', 'salesReports', 'creditLimits', 'creditLimitHistory')
        or (
          collection_name = 'stockTransactions'
          and lower(coalesce(record_data ->> 'type', '')) in ('sale', 'return', 'write off', 'write_off')
        )
        or (
          collection_name = 'orders'
          and lower(coalesce(record_data ->> 'source', '')) = 'quick_sale'
        )
      );
  elsif v_scope = 'activity' then
    delete from public.workspace_operational_records
    where client_id = p_client_id and collection_name in ('activityLogs', 'salesReports');

    insert into public.workspace_operational_records (
      client_id, collection_name, record_id, record_data, updated_by_user_id, updated_at
    ) values (
      p_client_id,
      'activityLogs',
      v_marker_id,
      jsonb_build_object(
        'id', v_marker_id,
        'clientId', p_client_id,
        'actionType', 'reset',
        'recordType', 'activity_reset_marker',
        'recordLabel', '',
        'actorUserId', v_user_id,
        'actorName', 'CEO',
        'summary', '',
        'hidden', true,
        'createdAt', now()
      ),
      v_user_id,
      now()
    );
  else
    delete from public.workspace_operational_records where client_id = p_client_id;

    delete from public.packaging_change_requests where client_id = p_client_id;

    delete from public.production_batch_materials
    where batch_id in (select id from public.production_batches where client_id = p_client_id);
    delete from public.stock_transactions where client_id = p_client_id;
    delete from public.stock_assignments where client_id = p_client_id;
    delete from public.production_batches where client_id = p_client_id;
    delete from public.stock_products where client_id = p_client_id;
    delete from public.stock_categories where client_id = p_client_id;
  end if;
  get diagnostics v_count = row_count;
  v_deleted := v_deleted + v_count;

  if v_scope = 'factory' then
    delete from public.workspace_operational_collections where client_id = p_client_id;
    insert into public.workspace_operational_collections (
      client_id, collection_name, updated_by_user_id, updated_at
    )
    select p_client_id, collection_name, v_user_id, now()
    from unnest(v_collections) as collection_name;
  else
    insert into public.workspace_operational_collections (
      client_id, collection_name, updated_by_user_id, updated_at
    )
    select p_client_id, collection_name, v_user_id, now()
    from unnest(case v_scope
      when 'adjustments' then array['correctionRequests']::text[]
      when 'customers' then array['retailers']::text[]
      when 'finance' then array['invoices','salesReports','creditLimits','creditLimitHistory','stockTransactions','orders']::text[]
      when 'activity' then array['activityLogs','salesReports']::text[]
    end) as collection_name
    on conflict (client_id, collection_name) do update
    set updated_by_user_id = excluded.updated_by_user_id,
        updated_at = excluded.updated_at;
  end if;

  delete from public.workspace_operation_events
  where client_id = p_client_id;

  return jsonb_build_object(
    'scope', v_scope,
    'deleted', v_deleted,
    'markerId', case when v_scope = 'activity' then v_marker_id else null end,
    'completedAt', now()
  );
end;
$$;

revoke all on function public.reset_workspace_data(uuid, text) from public, anon, authenticated;
grant execute on function public.reset_workspace_data(uuid, text) to authenticated;
