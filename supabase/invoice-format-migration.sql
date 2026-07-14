alter table public.clients
add column if not exists invoice_format text not null default 'INV-{0000}';

alter table public.clients
drop column if exists inventory_format;
