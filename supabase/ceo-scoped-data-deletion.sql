-- Permanent, CEO-only deletion for finance, activity, and sales-order records.
-- The browser sends exact selected IDs so each section can be cleared without
-- deleting adjacent datasets.

alter table public.credit_limit_history
  alter column credit_limit_id drop not null;

alter table public.credit_limit_history
  drop constraint if exists credit_limit_history_credit_limit_id_fkey;

alter table public.credit_limit_history
  add constraint credit_limit_history_credit_limit_id_fkey
  foreign key (credit_limit_id) references public.credit_limits(id) on delete set null;

create or replace function public.delete_ceo_workspace_data(
  p_client_id uuid,
  p_scope text,
  p_record_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_scope text := lower(trim(coalesce(p_scope, '')));
  v_ids text[] := coalesce(p_record_ids, array[]::text[]);
  v_collection text;
  v_deleted integer := 0;
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select case when role = 'manager' then 'ceo' else role end
  into v_role
  from public.memberships
  where client_id = p_client_id
    and user_id = auth.uid()
    and status = 'active'
    and not password_reset_required
  limit 1;

  if v_role <> 'ceo' then
    raise exception 'Only the CEO can permanently delete company records';
  end if;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Choose at least one record to delete';
  end if;

  v_collection := case v_scope
    when 'sales_reports' then 'salesReports'
    when 'invoices' then 'invoices'
    when 'representative_credit_limits' then 'creditLimits'
    when 'customer_credit_limits' then 'creditLimits'
    when 'representative_credit_history' then 'creditLimitHistory'
    when 'customer_credit_history' then 'creditLimitHistory'
    when 'activity' then 'activityLogs'
    when 'orders' then 'orders'
    when 'product_revenue' then 'stockTransactions'
    else null
  end;

  if v_collection is null then
    raise exception 'Unsupported deletion scope';
  end if;

  delete from public.workspace_operational_records
  where client_id = p_client_id
    and collection_name = v_collection
    and record_id = any(v_ids)
    and v_scope <> 'product_revenue';
  get diagnostics v_count = row_count;
  v_deleted := v_deleted + v_count;

  if v_scope = 'activity' then
    delete from public.activity_logs
    where client_id = p_client_id and id::text = any(v_ids);
    get diagnostics v_count = row_count;
    v_deleted := v_deleted + v_count;
  elsif v_scope in ('representative_credit_history', 'customer_credit_history') then
    delete from public.credit_limit_history
    where client_id = p_client_id and id::text = any(v_ids);
    get diagnostics v_count = row_count;
    v_deleted := v_deleted + v_count;
  elsif v_scope in ('representative_credit_limits', 'customer_credit_limits') then
    delete from public.credit_limits
    where client_id = p_client_id and id::text = any(v_ids);
    get diagnostics v_count = row_count;
    v_deleted := v_deleted + v_count;
  end if;

  insert into public.workspace_operational_collections (
    client_id, collection_name, updated_by_user_id, updated_at
  ) values (
    p_client_id, v_collection, auth.uid(), now()
  )
  on conflict (client_id, collection_name) do update
  set updated_by_user_id = excluded.updated_by_user_id,
      updated_at = excluded.updated_at;

  -- Operational events contain snapshots of changed records. Remove those
  -- snapshots so data explicitly deleted by the CEO is not retained as an
  -- accessible backend copy.
  delete from public.workspace_operation_events
  where client_id = p_client_id;

  return jsonb_build_object(
    'scope', v_scope,
    'deleted', v_deleted,
    'completedAt', now()
  );
end;
$$;

revoke all on function public.delete_ceo_workspace_data(uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.delete_ceo_workspace_data(uuid, text, text[]) to authenticated;
