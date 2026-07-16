create or replace function public.activate_my_membership(
  p_client_id uuid,
  p_new_password text
)
returns public.memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership public.memberships;
  v_auth_updated_at timestamptz;
  v_reset_requested_at timestamptz;
  v_initial_password_fingerprint text;
  v_current_password_fingerprint text;
  v_initial_password_hash text;
  v_current_password_hash text;
  v_new_password text := coalesce(p_new_password, '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if char_length(v_new_password) < 8
    or v_new_password !~ '[a-z]'
    or v_new_password !~ '[A-Z]'
    or v_new_password !~ '[0-9]'
    or v_new_password !~ '[^A-Za-z0-9]' then
    raise exception 'Use 8 or more characters with uppercase, lowercase, a number, and a symbol';
  end if;

  select memberships.*
  into v_membership
  from public.memberships
  where client_id = p_client_id
    and user_id = auth.uid()
    and status in ('active', 'invited')
    and password_reset_required
  for update;

  if v_membership.id is null then
    raise exception 'A pending password setup was not found';
  end if;

  select
    users.updated_at,
    encode(extensions.digest(coalesce(users.encrypted_password, ''), 'sha256'), 'hex'),
    users.encrypted_password
  into
    v_auth_updated_at,
    v_current_password_fingerprint,
    v_current_password_hash
  from auth.users users
  where users.id = auth.uid();

  select
    password_security.requested_at,
    password_security.password_fingerprint,
    password_security.password_hash_at_request
  into
    v_reset_requested_at,
    v_initial_password_fingerprint,
    v_initial_password_hash
  from public.membership_password_security password_security
  where password_security.membership_id = v_membership.id;

  v_reset_requested_at := greatest(
    v_membership.created_at,
    coalesce(v_reset_requested_at, v_membership.password_reset_requested_at, v_membership.created_at)
  );

  if v_auth_updated_at is null
    or v_auth_updated_at <= v_reset_requested_at
    or v_initial_password_fingerprint is null
    or v_current_password_fingerprint is not distinct from v_initial_password_fingerprint
    or v_initial_password_hash is null
    or v_initial_password_hash = ''
    or extensions.crypt(v_new_password, v_initial_password_hash) = v_initial_password_hash
    or v_current_password_hash is null
    or extensions.crypt(v_new_password, v_current_password_hash) <> v_current_password_hash then
    raise exception 'Change your password before completing account setup';
  end if;

  update public.memberships
  set
    status = 'active',
    password_reset_required = false
  where id = v_membership.id
  returning * into v_membership;

  delete from public.membership_password_security
  where membership_id = v_membership.id;

  return v_membership;
end;
$$;

grant execute on function public.activate_my_membership(uuid, text) to authenticated;
revoke all on function public.activate_my_membership(uuid, text) from public, anon;
