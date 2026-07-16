begin;

alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.invites drop constraint if exists invites_role_check;

alter table public.memberships
add constraint memberships_role_check
check (role in ('sales_rep', 'store_keeper', 'admin', 'accountant', 'ceo'));

alter table public.invites
add constraint invites_role_check
check (role in ('sales_rep', 'store_keeper', 'admin', 'accountant', 'ceo'));

create or replace function public.set_membership_role(
  p_client_id uuid,
  p_membership_id uuid,
  p_role text
)
returns public.memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership public.memberships;
  v_role text := lower(trim(coalesce(p_role, '')));
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_client_role(p_client_id, array['ceo']) then
    raise exception 'CEO access required';
  end if;

  if v_role not in ('sales_rep', 'store_keeper', 'admin') then
    raise exception 'Choose a valid staff role';
  end if;

  select * into v_membership
  from public.memberships
  where id = p_membership_id
    and client_id = p_client_id;

  if v_membership.id is null then
    raise exception 'Staff account not found';
  end if;

  if v_membership.user_id = auth.uid() or v_membership.role = 'ceo' then
    raise exception 'The CEO role cannot be changed here';
  end if;

  update public.memberships
  set role = v_role
  where id = p_membership_id
  returning * into v_membership;

  return v_membership;
end;
$$;

grant execute on function public.set_membership_role(uuid, uuid, text) to authenticated;
revoke all on function public.set_membership_role(uuid, uuid, text) from public, anon;

commit;
