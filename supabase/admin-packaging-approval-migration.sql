-- Allow Admin and Store Keeper staff to request Sales Packaging changes.
-- Only the CEO can apply, approve, or decline those changes.

alter table public.packaging_change_requests
alter column requested_by_name set default 'Staff member';

drop policy if exists "packaging_change_requests_select" on public.packaging_change_requests;
create policy "packaging_change_requests_select"
on public.packaging_change_requests
for select
to authenticated
using (
  public.has_client_role(client_id, array['ceo'])
  or (
    public.has_client_role(client_id, array['admin', 'store_keeper'])
    and requested_by_user_id = auth.uid()
  )
);

create or replace function public.update_packaging_settings(
  p_client_id uuid,
  p_packaging_types text[],
  p_packaging_defaults jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_types text[];
begin
  if not public.has_client_role(p_client_id, array['ceo']) then
    raise exception 'CEO access required';
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

  update public.clients
  set packaging_types = to_jsonb(coalesce(v_types, array['piece'])),
      packaging_defaults = (
        select jsonb_object_agg(package_type, piece_count)
        from (
          select package_type,
            case when package_type = 'piece' then 1
              else greatest(1, floor(coalesce((p_packaging_defaults ->> package_type)::numeric, 1)))::integer
            end as piece_count
          from unnest(coalesce(v_types, array['piece'])) package_type
        ) configured_defaults
      )
  where id = p_client_id;
end;
$$;

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
  if not public.has_client_role(p_client_id, array['admin', 'store_keeper']) then
    raise exception 'Admin or Store Keeper access required';
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
    coalesce(v_requester_name, 'Staff member'),
    to_jsonb(coalesce(v_types, array['piece'])),
    coalesce(v_defaults, '{"piece":1}'::jsonb)
  ) returning id into v_request_id;

  insert into public.activity_logs (
    client_id, action_type, record_type, record_label,
    actor_user_id, actor_name, summary
  ) values (
    p_client_id, 'requested', 'packaging_settings', v_request_id::text,
    auth.uid(), coalesce(v_requester_name, 'Staff member'),
    coalesce(v_requester_name, 'Staff member') || ' requested a Sales Packaging change'
  );

  return v_request_id;
end;
$$;

revoke all on function public.update_packaging_settings(uuid, text[], jsonb) from public, anon;
revoke all on function public.request_packaging_settings_change(uuid, text[], jsonb) from public, anon;
grant execute on function public.update_packaging_settings(uuid, text[], jsonb) to authenticated;
grant execute on function public.request_packaging_settings_change(uuid, text[], jsonb) to authenticated;
