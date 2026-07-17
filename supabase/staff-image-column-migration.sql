alter table public.memberships
add column if not exists staff_image_url text not null default '';

notify pgrst, 'reload schema';
