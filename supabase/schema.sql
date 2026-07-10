create extension if not exists pgcrypto;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  logo_data_url text default '',
  brand_color text not null default '#0B1F3A',
  timezone text not null default 'Africa/Lagos',
  currency text not null default 'NGN',
  currency_symbol text not null default '₦',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.clients
add column if not exists brand_color text not null default '#0B1F3A';

alter table public.clients
add column if not exists date_format text not null default 'DD/MM/YYYY';

alter table public.clients
add column if not exists document_business_name text not null default '';

do $$ begin
  alter table public.clients
  add constraint clients_brand_color_hex
  check (brand_color ~ '^#[0-9A-Fa-f]{6}$');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  role text not null default 'sales_rep',
  status text not null default 'invited' check (status in ('invited', 'active', 'disabled')),
  password_reset_required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, email),
  unique (client_id, user_id)
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  membership_id uuid references public.memberships(id) on delete set null,
  email text not null,
  name text not null,
  role text not null default 'sales_rep',
  subject text not null,
  redirect_to text,
  status text not null default 'sent' check (status in ('ready', 'sent', 'accepted', 'revoked')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  action_type text not null,
  record_type text not null,
  record_label text not null default '',
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text not null default 'Team member',
  actor_email text not null default '',
  summary text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  from_membership_id uuid not null references public.memberships(id) on delete cascade,
  to_membership_id uuid not null references public.memberships(id) on delete cascade,
  audience text not null default 'direct' check (audience in ('direct', 'all_staff')),
  body text not null check (char_length(trim(body)) between 1 and 800),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists workspace_messages_recipient_created_at_idx
on public.workspace_messages (client_id, to_membership_id, created_at desc);

create index if not exists workspace_messages_sender_created_at_idx
on public.workspace_messages (client_id, from_membership_id, created_at desc);

create table if not exists public.stock_categories (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  code text not null check (code in ('raw_materials', 'finished_products', 'equipment')),
  name text not null,
  timeframe text not null default '',
  behavior text not null default '',
  created_at timestamptz not null default now(),
  unique (client_id, code)
);

create table if not exists public.stock_products (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  category_id uuid references public.stock_categories(id) on delete set null,
  sku text not null,
  name text not null,
  warehouse text not null default '',
  region text not null default 'Factory',
  stock numeric(14, 2) not null default 0 check (stock >= 0),
  reorder_point numeric(14, 2) not null default 0 check (reorder_point >= 0),
  daily_velocity numeric(14, 2) not null default 0 check (daily_velocity >= 0),
  unit_cost numeric(14, 2) not null default 0 check (unit_cost >= 0),
  unit_price numeric(14, 2) not null default 0 check (unit_price >= 0),
  equipment_status text check (equipment_status is null or equipment_status in ('in_stock', 'assigned', 'sold')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, sku)
);

alter table public.stock_products
add column if not exists unit text not null default 'unit';

alter table public.stock_products
add column if not exists image_url text not null default '';

alter table public.stock_products
add column if not exists status text not null default 'active';

do $$ begin
  alter table public.stock_products
  add constraint stock_products_status_check
  check (status in ('active', 'inactive'));
exception
  when duplicate_object then null;
end $$;

create table if not exists public.stock_assignments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  product_id uuid not null references public.stock_products(id) on delete restrict,
  rep_membership_id uuid references public.memberships(id) on delete set null,
  route_label text not null default '',
  rep_name text not null,
  assigned_at date not null default current_date,
  quantity_assigned numeric(14, 2) not null default 0 check (quantity_assigned >= 0),
  quantity_sold numeric(14, 2) not null default 0 check (quantity_sold >= 0),
  quantity_returned numeric(14, 2) not null default 0 check (quantity_returned >= 0),
  status text not null default 'open' check (status in ('open', 'reconciled')),
  created_at timestamptz not null default now()
);

create table if not exists public.stock_transactions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  product_id uuid references public.stock_products(id) on delete set null,
  assignment_id uuid references public.stock_assignments(id) on delete set null,
  transaction_type text not null check (transaction_type in ('sale', 'return', 'supply', 'internal_movement', 'write_off')),
  quantity numeric(14, 2) not null default 0 check (quantity >= 0),
  amount numeric(14, 2) not null default 0,
  payment_type text not null default 'none',
  party_type text not null default '',
  party_name text not null default '',
  recorded_by_user_id uuid references auth.users(id) on delete set null,
  recorded_by_name text not null default 'Team member',
  occurred_at date not null default current_date,
  credit_impact numeric(14, 2) not null default 0,
  created_at timestamptz not null default now()
);

alter table public.stock_transactions
add column if not exists recipient_name text not null default '';

alter table public.stock_transactions
add column if not exists dispatch_destination text not null default '';

alter table public.stock_transactions
add column if not exists staff_responsible text not null default '';

alter table public.stock_transactions
add column if not exists movement_direction text not null default 'out';

do $$ begin
  alter table public.stock_transactions
  add constraint stock_transactions_movement_direction_check
  check (movement_direction in ('in', 'out', 'neutral'));
exception
  when duplicate_object then null;
end $$;

create table if not exists public.credit_limits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  party_type text not null check (party_type in ('sales_rep', 'supermarket')),
  party_name text not null,
  membership_id uuid references public.memberships(id) on delete set null,
  limit_amount numeric(14, 2) not null default 0 check (limit_amount >= 0),
  balance_amount numeric(14, 2) not null default 0 check (balance_amount >= 0),
  previous_limit_amount numeric(14, 2) not null default 0 check (previous_limit_amount >= 0),
  changed_by_user_id uuid references auth.users(id) on delete set null,
  changed_by_name text not null default 'Manager',
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.credit_limits
add column if not exists discount_percent numeric(6, 2) not null default 0 check (discount_percent >= 0 and discount_percent <= 100);

alter table public.credit_limits
add column if not exists payment_period_days integer not null default 14 check (payment_period_days >= 0);

alter table public.credit_limits
add column if not exists late_penalty_percent numeric(6, 2) not null default 0 check (late_penalty_percent >= 0 and late_penalty_percent <= 100);

create table if not exists public.credit_limit_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  credit_limit_id uuid not null references public.credit_limits(id) on delete restrict,
  party_type text not null,
  party_name text not null,
  previous_limit_amount numeric(14, 2) not null default 0,
  new_limit_amount numeric(14, 2) not null default 0,
  discount_percent numeric(6, 2) not null default 0,
  payment_period_days integer not null default 14,
  late_penalty_percent numeric(6, 2) not null default 0,
  changed_by_user_id uuid references auth.users(id) on delete set null,
  changed_by_name text not null default 'Manager',
  changed_at timestamptz not null default now()
);

create index if not exists credit_limit_history_client_changed_at_idx
on public.credit_limit_history (client_id, changed_at desc);

create or replace function public.capture_credit_limit_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := coalesce(new.changed_by_user_id, auth.uid());
  v_actor_name text;
begin
  if tg_op = 'UPDATE'
    and old.limit_amount is not distinct from new.limit_amount
    and old.discount_percent is not distinct from new.discount_percent
    and old.payment_period_days is not distinct from new.payment_period_days
    and old.late_penalty_percent is not distinct from new.late_penalty_percent then
    return new;
  end if;

  select m.name
  into v_actor_name
  from public.memberships m
  where m.client_id = new.client_id
    and m.user_id = v_actor_user_id
  limit 1;

  insert into public.credit_limit_history (
    client_id,
    credit_limit_id,
    party_type,
    party_name,
    previous_limit_amount,
    new_limit_amount,
    discount_percent,
    payment_period_days,
    late_penalty_percent,
    changed_by_user_id,
    changed_by_name,
    changed_at
  ) values (
    new.client_id,
    new.id,
    new.party_type,
    new.party_name,
    case when tg_op = 'INSERT' then 0 else old.limit_amount end,
    new.limit_amount,
    new.discount_percent,
    new.payment_period_days,
    new.late_penalty_percent,
    v_actor_user_id,
    coalesce(v_actor_name, new.changed_by_name, 'Manager'),
    coalesce(new.changed_at, now())
  );

  return new;
end;
$$;

drop trigger if exists credit_limit_history_capture on public.credit_limits;
create trigger credit_limit_history_capture
after insert or update on public.credit_limits
for each row execute function public.capture_credit_limit_history();

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null default 'Super Admin',
  mfa_required boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_feature_modules (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  module_key text not null,
  enabled boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (client_id, module_key)
);

create table if not exists public.platform_email_templates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  template_key text not null default 'default_invite',
  sender_name text not null default 'DistroIQ Operations',
  sender_email text not null default 'no-reply@distroiq.local',
  subject text not null default 'DistroIQ notification',
  body text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (client_id, template_key)
);

create table if not exists public.platform_document_sequences (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  sequence_key text not null default 'delivery_note',
  prefix text not null default 'DN',
  next_number bigint not null default 1 check (next_number > 0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (client_id, sequence_key)
);

create table if not exists public.platform_audit_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  action_type text not null,
  record_type text not null,
  record_label text not null default '',
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text not null default 'Bex Lab Innovations',
  actor_email text not null default '',
  summary text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.platform_health_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  service_name text not null default 'DistroIQ',
  event_type text not null default 'monitor',
  status text not null default 'ready' check (status in ('ready', 'open', 'warning', 'failed', 'resolved')),
  summary text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.clients enable row level security;
alter table public.memberships enable row level security;
alter table public.invites enable row level security;
alter table public.activity_logs enable row level security;
alter table public.workspace_messages enable row level security;
alter table public.stock_categories enable row level security;
alter table public.stock_products enable row level security;
alter table public.stock_assignments enable row level security;
alter table public.stock_transactions enable row level security;
alter table public.credit_limits enable row level security;
alter table public.credit_limit_history enable row level security;
alter table public.platform_admins enable row level security;
alter table public.platform_feature_modules enable row level security;
alter table public.platform_email_templates enable row level security;
alter table public.platform_document_sequences enable row level security;
alter table public.platform_audit_logs enable row level security;
alter table public.platform_health_events enable row level security;

alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.invites drop constraint if exists invites_role_check;

alter table public.memberships alter column role drop default;
alter table public.invites alter column role drop default;

alter table public.memberships
alter column role type text
using role::text;

alter table public.invites
alter column role type text
using role::text;

update public.memberships
set role = case role
  when 'owner' then 'manager'
  when 'admin' then 'manager'
  when 'operations' then 'store_keeper'
  when 'finance' then 'accountant'
  when 'viewer' then 'ceo'
  when 'super_admin' then 'manager'
  else role
end
where role in ('owner', 'admin', 'operations', 'finance', 'viewer', 'super_admin');

update public.invites
set role = case role
  when 'owner' then 'manager'
  when 'admin' then 'manager'
  when 'operations' then 'store_keeper'
  when 'finance' then 'accountant'
  when 'viewer' then 'ceo'
  when 'super_admin' then 'manager'
  else role
end
where role in ('owner', 'admin', 'operations', 'finance', 'viewer', 'super_admin');

update public.memberships
set role = 'sales_rep'
where role not in ('sales_rep', 'manager', 'store_keeper', 'accountant', 'ceo');

update public.invites
set role = 'sales_rep'
where role not in ('sales_rep', 'manager', 'store_keeper', 'accountant', 'ceo');

alter table public.memberships alter column role set default 'sales_rep';
alter table public.invites alter column role set default 'sales_rep';

alter table public.memberships
add constraint memberships_role_check
check (role in ('sales_rep', 'manager', 'store_keeper', 'accountant', 'ceo'));

alter table public.invites
add constraint invites_role_check
check (role in ('sales_rep', 'manager', 'store_keeper', 'accountant', 'ceo'));

create or replace function public.is_client_member(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where client_id = p_client_id
      and user_id = auth.uid()
      and status in ('active', 'invited')
  );
$$;

create or replace function public.is_client_admin(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where client_id = p_client_id
      and user_id = auth.uid()
      and status = 'active'
      and role in ('ceo', 'manager')
  );
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins
    where user_id = auth.uid()
      and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
  );
$$;

create or replace function public.has_client_role(p_client_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where client_id = p_client_id
      and user_id = auth.uid()
      and status = 'active'
      and role = any(p_roles)
  );
$$;

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
  order by messages.created_at asc;
end;
$$;

create or replace function public.send_workspace_message(
  p_client_id uuid,
  p_body text,
  p_recipient_membership_id uuid default null,
  p_audience text default 'direct'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender public.memberships%rowtype;
  v_body text;
  v_audience text;
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_sender
  from public.memberships
  where client_id = p_client_id
    and user_id = auth.uid()
    and status = 'active'
  limit 1;

  if v_sender.id is null then
    raise exception 'Company access required';
  end if;

  v_body := trim(coalesce(p_body, ''));
  v_audience := coalesce(nullif(trim(p_audience), ''), 'direct');

  if char_length(v_body) < 1 or char_length(v_body) > 800 then
    raise exception 'Messages must be between 1 and 800 characters';
  end if;

  if v_audience = 'all_staff' then
    if v_sender.role not in ('manager', 'ceo') then
      raise exception 'Only managers and CEOs can message all staff';
    end if;

    insert into public.workspace_messages (
      client_id,
      from_membership_id,
      to_membership_id,
      audience,
      body
    )
    select
      p_client_id,
      v_sender.id,
      recipient.id,
      'all_staff',
      v_body
    from public.memberships recipient
    where recipient.client_id = p_client_id
      and recipient.id <> v_sender.id
      and recipient.status in ('active', 'invited');

    get diagnostics v_count = row_count;

    if v_count = 0 then
      raise exception 'No staff accounts are available to receive this message';
    end if;

    return v_count;
  end if;

  if v_audience <> 'direct' then
    raise exception 'Invalid message audience';
  end if;

  if p_recipient_membership_id is null then
    raise exception 'Choose a staff member';
  end if;

  if not exists (
    select 1
    from public.memberships recipient
    where recipient.id = p_recipient_membership_id
      and recipient.client_id = p_client_id
      and recipient.id <> v_sender.id
      and recipient.status in ('active', 'invited')
  ) then
    raise exception 'The selected staff member is not available';
  end if;

  insert into public.workspace_messages (
    client_id,
    from_membership_id,
    to_membership_id,
    audience,
    body
  )
  values (
    p_client_id,
    v_sender.id,
    p_recipient_membership_id,
    'direct',
    v_body
  );

  return 1;
end;
$$;

create or replace function public.mark_my_workspace_conversation_read(
  p_client_id uuid,
  p_peer_membership_id uuid
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
  limit 1;

  if v_current_membership_id is null then
    raise exception 'Company access required';
  end if;

  update public.workspace_messages
  set read_at = now()
  where client_id = p_client_id
    and from_membership_id = p_peer_membership_id
    and to_membership_id = v_current_membership_id
    and read_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.create_client_workspace(
  p_company_name text,
  p_logo_data_url text,
  p_brand_color text,
  p_timezone text,
  p_currency text,
  p_currency_symbol text
)
returns public.clients
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.clients;
  v_email text;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_email := coalesce(auth.jwt() ->> 'email', '');
  v_name := coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', v_email, 'CEO');

  insert into public.clients (
    company_name,
    logo_data_url,
    brand_color,
    document_business_name,
    timezone,
    currency,
    currency_symbol,
    created_by
  )
  values (
    nullif(trim(p_company_name), ''),
    coalesce(p_logo_data_url, ''),
    coalesce(nullif(trim(p_brand_color), ''), '#0B1F3A'),
    nullif(trim(p_company_name), ''),
    coalesce(nullif(trim(p_timezone), ''), 'Africa/Lagos'),
    coalesce(nullif(trim(p_currency), ''), 'NGN'),
    coalesce(nullif(trim(p_currency_symbol), ''), '₦'),
    auth.uid()
  )
  returning * into v_client;

  insert into public.memberships (
    client_id,
    user_id,
    email,
    name,
    role,
    status,
    password_reset_required
  )
  values (
    v_client.id,
    auth.uid(),
    v_email,
    v_name,
    'ceo',
    'active',
    false
  );

  return v_client;
end;
$$;

create or replace function public.get_platform_overview()
returns table (
  client_id uuid,
  company_name text,
  timezone text,
  currency_symbol text,
  created_at timestamptz,
  account_count bigint,
  active_account_count bigint,
  invite_count bigint,
  activity_count bigint,
  last_activity_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;

  return query
  select
    clients.id as client_id,
    clients.company_name,
    clients.timezone,
    clients.currency_symbol,
    clients.created_at,
    count(distinct memberships.id) as account_count,
    count(distinct memberships.id) filter (where memberships.status = 'active') as active_account_count,
    count(distinct invites.id) as invite_count,
    count(distinct activity_logs.id) as activity_count,
    max(activity_logs.created_at) as last_activity_at
  from public.clients
  left join public.memberships on memberships.client_id = clients.id
  left join public.invites on invites.client_id = clients.id
  left join public.activity_logs on activity_logs.client_id = clients.id
  group by clients.id
  order by clients.created_at desc;
end;
$$;

create or replace function public.get_platform_console()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_console jsonb;
  v_active_sessions bigint := 0;
  v_storage_used_bytes bigint := 0;
  v_storage_limit_bytes bigint := 1073741824;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;

  begin
    select count(*)
    into v_active_sessions
    from auth.sessions
    where updated_at >= now() - interval '1 hour';
  exception
    when others then
      v_active_sessions := 0;
  end;

  begin
    select coalesce(sum(
      case
        when metadata ->> 'size' ~ '^[0-9]+$' then (metadata ->> 'size')::bigint
        else 0
      end
    ), 0)
    into v_storage_used_bytes
    from storage.objects;
  exception
    when others then
      v_storage_used_bytes := 0;
  end;

  begin
    v_storage_limit_bytes := coalesce(nullif(current_setting('app.storage_limit_bytes', true), '')::bigint, 1073741824);
  exception
    when others then
      v_storage_limit_bytes := 1073741824;
  end;

  with client_stats as (
    select
      clients.id,
      clients.company_name,
      clients.timezone,
      clients.currency_symbol,
      clients.brand_color,
      clients.date_format,
      clients.document_business_name,
      clients.created_at,
      count(distinct memberships.id) as account_count,
      count(distinct memberships.id) filter (where memberships.status = 'active') as active_account_count,
      count(distinct invites.id) as invite_count,
      count(distinct activity_logs.id) as activity_count,
      max(activity_logs.created_at) as last_activity_at
    from public.clients
    left join public.memberships on memberships.client_id = clients.id
    left join public.invites on invites.client_id = clients.id
    left join public.activity_logs on activity_logs.client_id = clients.id
    group by clients.id
  ),
  platform_stats as (
    select
      count(*) as client_count,
      coalesce(sum(account_count), 0) total_accounts,
      coalesce(sum(active_account_count), 0) total_active_accounts,
      coalesce(sum(invite_count), 0) total_invites,
      coalesce(sum(activity_count), 0) total_activity
    from client_stats
  )
  select jsonb_build_object(
    'stats', (
      select jsonb_build_object(
        'companies', client_count,
        'accounts', total_accounts,
        'activeAccounts', total_active_accounts,
        'invites', total_invites,
        'activity', total_activity,
        'activeSessions', v_active_sessions,
        'storageUsedBytes', v_storage_used_bytes,
        'storageLimitBytes', v_storage_limit_bytes
      )
      from platform_stats
    ),
    'clients', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', id,
          'client_id', id,
          'company_name', company_name,
          'timezone', timezone,
          'currency_symbol', currency_symbol,
          'brand_color', brand_color,
          'dateFormat', date_format,
          'documentBusinessName', coalesce(nullif(document_business_name, ''), company_name),
          'created_at', created_at,
          'account_count', account_count,
          'active_account_count', active_account_count,
          'invite_count', invite_count,
          'activity_count', activity_count,
          'last_activity_at', last_activity_at
        )
        order by created_at desc
      )
      from client_stats
    ), '[]'::jsonb),
    'users', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', memberships.id,
          'clientId', memberships.client_id,
          'companyName', clients.company_name,
          'userId', memberships.user_id,
          'name', memberships.name,
          'email', memberships.email,
          'role', memberships.role,
          'status', memberships.status,
          'passwordResetRequired', memberships.password_reset_required,
          'createdAt', memberships.created_at
        )
        order by memberships.created_at desc
      )
      from public.memberships
      join public.clients on clients.id = memberships.client_id
    ), '[]'::jsonb),
    'featureModules', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', id,
          'clientId', client_id,
          'moduleKey', module_key,
          'enabled', enabled,
          'updatedAt', updated_at
        )
        order by updated_at desc
      )
      from public.platform_feature_modules
    ), '[]'::jsonb),
    'emailTemplates', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', id,
          'clientId', client_id,
          'templateKey', template_key,
          'senderName', sender_name,
          'senderEmail', sender_email,
          'subject', subject,
          'updatedAt', updated_at
        )
        order by updated_at desc
      )
      from public.platform_email_templates
    ), '[]'::jsonb),
    'documentSequences', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', id,
          'clientId', client_id,
          'sequenceKey', sequence_key,
          'prefix', prefix,
          'nextNumber', next_number,
          'updatedAt', updated_at
        )
        order by updated_at desc
      )
      from public.platform_document_sequences
    ), '[]'::jsonb),
    'auditLogs', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', audit_rows.id,
          'clientId', audit_rows.client_id,
          'companyName', audit_rows.company_name,
          'actionType', audit_rows.action_type,
          'recordType', audit_rows.record_type,
          'recordLabel', audit_rows.record_label,
          'actorUserId', audit_rows.actor_user_id,
          'actorName', audit_rows.actor_name,
          'actorEmail', audit_rows.actor_email,
          'summary', audit_rows.summary,
          'createdAt', audit_rows.created_at
        )
        order by audit_rows.created_at desc
      )
      from (
        select
          platform_audit_logs.id,
          platform_audit_logs.client_id,
          clients.company_name,
          platform_audit_logs.action_type,
          platform_audit_logs.record_type,
          platform_audit_logs.record_label,
          platform_audit_logs.actor_user_id,
          platform_audit_logs.actor_name,
          platform_audit_logs.actor_email,
          platform_audit_logs.summary,
          platform_audit_logs.created_at
        from public.platform_audit_logs
        left join public.clients on clients.id = platform_audit_logs.client_id
        union all
        select
          activity_logs.id,
          activity_logs.client_id,
          clients.company_name,
          activity_logs.action_type,
          activity_logs.record_type,
          activity_logs.record_label,
          activity_logs.actor_user_id,
          activity_logs.actor_name,
          activity_logs.actor_email,
          activity_logs.summary,
          activity_logs.created_at
        from public.activity_logs
        join public.clients on clients.id = activity_logs.client_id
        order by created_at desc
        limit 80
      ) audit_rows
    ), '[]'::jsonb),
    'healthEvents', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', platform_health_events.id,
          'clientId', platform_health_events.client_id,
          'companyName', clients.company_name,
          'serviceName', platform_health_events.service_name,
          'eventType', platform_health_events.event_type,
          'status', platform_health_events.status,
          'summary', platform_health_events.summary,
          'metadata', platform_health_events.metadata,
          'createdAt', platform_health_events.created_at
        )
        order by platform_health_events.created_at desc
      )
      from public.platform_health_events
      left join public.clients on clients.id = platform_health_events.client_id
    ), '[]'::jsonb),
    'platformAdmins', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'userId', user_id,
          'email', email,
          'name', name,
          'mfaRequired', mfa_required,
          'createdAt', created_at
        )
        order by created_at desc
      )
      from public.platform_admins
    ), '[]'::jsonb)
  )
  into v_console;

  return v_console;
end;
$$;

create or replace function public.record_activity(
  p_client_id uuid,
  p_action_type text,
  p_record_type text,
  p_record_label text,
  p_summary text
)
returns public.activity_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log public.activity_logs;
  v_actor_name text;
  v_actor_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_client_member(p_client_id) then
    raise exception 'Company access required';
  end if;

  select name, email
  into v_actor_name, v_actor_email
  from public.memberships
  where client_id = p_client_id
    and user_id = auth.uid()
  order by created_at desc
  limit 1;

  v_actor_email := coalesce(v_actor_email, auth.jwt() ->> 'email', '');
  v_actor_name := coalesce(v_actor_name, auth.jwt() -> 'user_metadata' ->> 'full_name', v_actor_email, 'Team member');

  insert into public.activity_logs (
    client_id,
    action_type,
    record_type,
    record_label,
    actor_user_id,
    actor_name,
    actor_email,
    summary
  )
  values (
    p_client_id,
    nullif(trim(p_action_type), ''),
    nullif(trim(p_record_type), ''),
    coalesce(p_record_label, ''),
    auth.uid(),
    v_actor_name,
    v_actor_email,
    coalesce(p_summary, 'Record updated')
  )
  returning * into v_log;

  return v_log;
end;
$$;

create or replace function public.activate_my_membership(p_client_id uuid)
returns public.memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership public.memberships;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.memberships
  set
    status = 'active',
    password_reset_required = false
  where client_id = p_client_id
    and user_id = auth.uid()
  returning * into v_membership;

  if v_membership.id is null then
    raise exception 'Membership not found';
  end if;

  return v_membership;
end;
$$;

grant execute on function public.create_client_workspace(text, text, text, text, text, text) to authenticated;
grant execute on function public.record_activity(uuid, text, text, text, text) to authenticated;
grant execute on function public.activate_my_membership(uuid) to authenticated;
grant execute on function public.is_client_member(uuid) to authenticated;
grant execute on function public.is_client_admin(uuid) to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.has_client_role(uuid, text[]) to authenticated;
grant execute on function public.get_my_workspace_messages(uuid) to authenticated;
grant execute on function public.send_workspace_message(uuid, text, uuid, text) to authenticated;
grant execute on function public.mark_my_workspace_conversation_read(uuid, uuid) to authenticated;
grant execute on function public.get_platform_overview() to authenticated;
grant execute on function public.get_platform_console() to authenticated;

grant select, update, delete on public.clients to authenticated;
grant select, insert, update on public.stock_categories to authenticated;
grant select, insert, update on public.stock_products to authenticated;
grant select, insert, update on public.stock_assignments to authenticated;
grant select, insert, update on public.stock_transactions to authenticated;
grant select, insert, update on public.credit_limits to authenticated;
revoke insert, update, delete on public.credit_limit_history from authenticated;
grant select on public.credit_limit_history to authenticated;
grant select on public.platform_admins to authenticated;
grant select, insert, update on public.platform_feature_modules to authenticated;
grant select, insert, update on public.platform_email_templates to authenticated;
grant select, insert, update on public.platform_document_sequences to authenticated;
grant select, insert on public.platform_audit_logs to authenticated;
grant select, insert on public.platform_health_events to authenticated;

drop policy if exists "clients_select_by_membership" on public.clients;
create policy "clients_select_by_membership"
on public.clients
for select
to authenticated
using (public.is_client_member(id) or public.is_platform_admin());

drop policy if exists "clients_update_by_admin" on public.clients;
create policy "clients_update_by_admin"
on public.clients
for update
to authenticated
using (public.is_client_admin(id))
with check (public.is_client_admin(id));

drop policy if exists "clients_delete_by_ceo" on public.clients;
create policy "clients_delete_by_ceo"
on public.clients
for delete
to authenticated
using (public.has_client_role(id, array['ceo']));

drop policy if exists "memberships_select_by_client" on public.memberships;
create policy "memberships_select_by_client"
on public.memberships
for select
to authenticated
using (public.is_client_member(client_id) or user_id = auth.uid() or public.is_platform_admin());

drop policy if exists "memberships_update_by_admin_or_self" on public.memberships;
create policy "memberships_update_by_admin_or_self"
on public.memberships
for update
to authenticated
using (public.is_client_admin(client_id) or user_id = auth.uid())
with check (public.is_client_admin(client_id) or user_id = auth.uid());

drop policy if exists "invites_select_by_admin" on public.invites;
create policy "invites_select_by_admin"
on public.invites
for select
to authenticated
using (public.is_client_admin(client_id) or public.is_platform_admin());

drop policy if exists "invites_insert_by_admin" on public.invites;
create policy "invites_insert_by_admin"
on public.invites
for insert
to authenticated
with check (public.is_client_admin(client_id));

drop policy if exists "invites_update_by_admin" on public.invites;
create policy "invites_update_by_admin"
on public.invites
for update
to authenticated
using (public.is_client_admin(client_id))
with check (public.is_client_admin(client_id));

drop policy if exists "activity_logs_select_by_client" on public.activity_logs;
create policy "activity_logs_select_by_client"
on public.activity_logs
for select
to authenticated
using (
  public.is_platform_admin()
  or public.has_client_role(client_id, array['ceo', 'manager'])
  or (
    public.has_client_role(client_id, array['accountant'])
    and record_type in ('sale', 'invoice', 'credit_limit', 'report')
  )
  or (
    public.has_client_role(client_id, array['store_keeper'])
    and record_type in ('inventory', 'stock_movement', 'route')
  )
);

drop policy if exists "platform_admins_select_self" on public.platform_admins;
create policy "platform_admins_select_self"
on public.platform_admins
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "platform_feature_modules_select" on public.platform_feature_modules;
create policy "platform_feature_modules_select"
on public.platform_feature_modules
for select
to authenticated
using (public.is_client_member(client_id) or public.is_platform_admin());

drop policy if exists "platform_feature_modules_write_by_platform" on public.platform_feature_modules;
create policy "platform_feature_modules_write_by_platform"
on public.platform_feature_modules
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "platform_email_templates_select_by_platform" on public.platform_email_templates;
create policy "platform_email_templates_select_by_platform"
on public.platform_email_templates
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists "platform_email_templates_write_by_platform" on public.platform_email_templates;
create policy "platform_email_templates_write_by_platform"
on public.platform_email_templates
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "platform_document_sequences_select_by_platform" on public.platform_document_sequences;
create policy "platform_document_sequences_select_by_platform"
on public.platform_document_sequences
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists "platform_document_sequences_write_by_platform" on public.platform_document_sequences;
create policy "platform_document_sequences_write_by_platform"
on public.platform_document_sequences
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "platform_audit_logs_select_by_platform" on public.platform_audit_logs;
create policy "platform_audit_logs_select_by_platform"
on public.platform_audit_logs
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists "platform_audit_logs_insert_by_platform" on public.platform_audit_logs;
create policy "platform_audit_logs_insert_by_platform"
on public.platform_audit_logs
for insert
to authenticated
with check (public.is_platform_admin());

drop policy if exists "platform_health_events_select_by_platform" on public.platform_health_events;
create policy "platform_health_events_select_by_platform"
on public.platform_health_events
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists "platform_health_events_insert_by_platform" on public.platform_health_events;
create policy "platform_health_events_insert_by_platform"
on public.platform_health_events
for insert
to authenticated
with check (public.is_platform_admin());

drop policy if exists "stock_categories_select_by_client" on public.stock_categories;
create policy "stock_categories_select_by_client"
on public.stock_categories
for select
to authenticated
using (public.is_client_member(client_id));

drop policy if exists "stock_categories_write_by_stock_roles" on public.stock_categories;
create policy "stock_categories_write_by_stock_roles"
on public.stock_categories
for all
to authenticated
using (public.has_client_role(client_id, array['ceo', 'manager', 'store_keeper']))
with check (public.has_client_role(client_id, array['ceo', 'manager', 'store_keeper']));

drop policy if exists "stock_products_select_by_client" on public.stock_products;
create policy "stock_products_select_by_client"
on public.stock_products
for select
to authenticated
using (public.is_client_member(client_id));

drop policy if exists "stock_products_write_by_stock_roles" on public.stock_products;
create policy "stock_products_write_by_stock_roles"
on public.stock_products
for all
to authenticated
using (public.has_client_role(client_id, array['ceo', 'manager', 'store_keeper']))
with check (public.has_client_role(client_id, array['ceo', 'manager', 'store_keeper']));

drop policy if exists "stock_assignments_select_by_client" on public.stock_assignments;
create policy "stock_assignments_select_by_client"
on public.stock_assignments
for select
to authenticated
using (public.is_client_member(client_id));

drop policy if exists "stock_assignments_write_by_stock_roles" on public.stock_assignments;
create policy "stock_assignments_write_by_stock_roles"
on public.stock_assignments
for all
to authenticated
using (public.has_client_role(client_id, array['manager', 'store_keeper']))
with check (public.has_client_role(client_id, array['manager', 'store_keeper']));

drop policy if exists "stock_transactions_select_by_client" on public.stock_transactions;
create policy "stock_transactions_select_by_client"
on public.stock_transactions
for select
to authenticated
using (public.is_client_member(client_id));

drop policy if exists "stock_transactions_write_by_stock_roles" on public.stock_transactions;
create policy "stock_transactions_write_by_stock_roles"
on public.stock_transactions
for all
to authenticated
using (public.has_client_role(client_id, array['manager', 'store_keeper', 'sales_rep']))
with check (public.has_client_role(client_id, array['manager', 'store_keeper', 'sales_rep']));

drop policy if exists "credit_limits_select_by_client" on public.credit_limits;
create policy "credit_limits_select_by_client"
on public.credit_limits
for select
to authenticated
using (public.is_client_member(client_id));

drop policy if exists "credit_limits_write_by_manager_roles" on public.credit_limits;
create policy "credit_limits_write_by_manager_roles"
on public.credit_limits
for all
to authenticated
using (public.has_client_role(client_id, array['manager', 'accountant', 'ceo']))
with check (public.has_client_role(client_id, array['manager', 'accountant', 'ceo']));

drop policy if exists "credit_limit_history_select_by_client" on public.credit_limit_history;
create policy "credit_limit_history_select_by_client"
on public.credit_limit_history
for select
to authenticated
using (public.is_client_member(client_id));

drop policy if exists "credit_limit_history_insert_by_manager_roles" on public.credit_limit_history;
