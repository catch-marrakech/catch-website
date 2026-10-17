-- Catch Gestion: database schema for Supabase
-- Run once in Supabase → SQL Editor → New query → Run.

create extension if not exists pgcrypto;

-- Daily sales (one row per day)
create table if not exists public.sales_days (
  day date primary key,
  cash numeric not null default 0,
  tpe numeric not null default 0,
  note text,
  updated_at timestamptz not null default now()
);

-- Expenses / invoices
create table if not exists public.costs (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  amount numeric not null default 0,
  supplier text not null default '',
  category text not null default 'Autre',
  note text,
  file_path text,
  file_type text,
  file_name text,
  paid boolean not null default false,
  pay_method text,
  paid_at date,
  created_at timestamptz not null default now()
);

-- Credits (money owed to the restaurant)
create table if not exists public.credits (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  amount numeric not null default 0,
  date date not null,
  note text,
  payments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Staff
create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text,
  phone text,
  salary numeric not null default 0,
  days integer not null default 26,
  ot_rate numeric not null default 0,
  start_month text,
  left_month text,
  created_at timestamptz not null default now()
);

-- Staff events: abs (days absent), ot (overtime hours), adv (advance DH), bon (bonus DH)
create table if not exists public.hr_events (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.staff(id) on delete cascade,
  type text not null check (type in ('abs','ot','adv','bon')),
  date date not null,
  value numeric not null default 0,
  note text,
  created_at timestamptz not null default now()
);

-- Salary paid per worker per month
create table if not exists public.hr_paid (
  worker_id uuid not null references public.staff(id) on delete cascade,
  month text not null,
  paid boolean not null default false,
  paid_at timestamptz,
  primary key (worker_id, month)
);

-- Row level security: only signed-in users can read or write
do $$
declare t text;
begin
  foreach t in array array['sales_days','costs','credits','staff','hr_events','hr_paid'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "signed in users" on public.%I', t);
    execute format('create policy "signed in users" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Private storage for invoice photos / PDFs
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 20971520, array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;

drop policy if exists "invoices signed in read" on storage.objects;
drop policy if exists "invoices signed in write" on storage.objects;
drop policy if exists "invoices signed in delete" on storage.objects;
create policy "invoices signed in read" on storage.objects for select to authenticated using (bucket_id = 'invoices');
create policy "invoices signed in write" on storage.objects for insert to authenticated with check (bucket_id = 'invoices');
create policy "invoices signed in delete" on storage.objects for delete to authenticated using (bucket_id = 'invoices');

-- Live updates
do $$
declare t text;
begin
  foreach t in array array['sales_days','costs','credits','staff','hr_events','hr_paid'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
