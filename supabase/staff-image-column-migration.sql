alter table public.memberships
add column if not exists staff_image_url text not null default '';

drop function if exists public.update_my_membership_profile(uuid, text);
drop function if exists public.update_my_membership_profile(uuid, text, text);
drop function if exists public.update_my_membership_profile(uuid, text, text, text);

create function public.update_my_membership_profile(
  p_client_id uuid,
  p_name text,
  p_phone_number text,
  p_staff_image_url text
)
returns public.memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership public.memberships;
  v_name text := trim(coalesce(p_name, ''));
  v_phone_number text := trim(coalesce(p_phone_number, ''));
  v_staff_image_url text := trim(coalesce(p_staff_image_url, ''));
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if char_length(v_name) < 2
    or char_length(v_name) > 120
    or v_name ~ '[[:cntrl:]]' then
    raise exception 'Name must be between 2 and 120 characters';
  end if;

  if char_length(v_phone_number) < 7
    or char_length(v_phone_number) > 32
    or v_phone_number !~ '^[+0-9().[:space:]-]+$' then
    raise exception 'Enter a valid phone number';
  end if;

  if char_length(v_staff_image_url) > 800000
    or (v_staff_image_url <> '' and v_staff_image_url !~ '^data:image/(png|jpeg|webp);base64,') then
    raise exception 'Choose a valid staff image';
  end if;

  update public.memberships
  set name = v_name,
      phone_number = v_phone_number,
      staff_image_url = v_staff_image_url
  where client_id = p_client_id
    and user_id = auth.uid()
    and status = 'active'
    and not password_reset_required
  returning * into v_membership;

  if v_membership.id is null then
    raise exception 'Active company access required';
  end if;

  return v_membership;
end;
$$;

grant execute on function public.update_my_membership_profile(uuid, text, text, text) to authenticated;
revoke all on function public.update_my_membership_profile(uuid, text, text, text) from public, anon;

notify pgrst, 'reload schema';
