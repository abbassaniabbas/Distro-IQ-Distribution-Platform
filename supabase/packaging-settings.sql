alter table public.clients
add column if not exists packaging_types jsonb not null default '["piece"]'::jsonb;

alter table public.clients
add column if not exists packaging_defaults jsonb not null default '{"piece":1}'::jsonb;

drop function if exists public.update_packaging_settings(uuid, text[]);

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

grant execute on function public.update_packaging_settings(uuid, text[], jsonb) to authenticated;
