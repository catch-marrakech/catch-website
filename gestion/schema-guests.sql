-- Catch Gestion · part 2: roles, guests (clients), reservations, visits
-- Run once in Supabase → SQL Editor, after schema.sql.

-- ---------- Roles ----------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  role text not null default 'staff' check (role in ('owner','manager','staff')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where user_id = auth.uid()
$$;
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('owner','manager') from public.profiles where user_id = auth.uid()), false)
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid())
$$;

-- every new login gets a profile with role "staff"; the owner promotes people in Catch Gestion
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, email, role) values (new.id, new.email, 'staff') on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
insert into public.profiles (user_id, email, role) select id, email, 'staff' from auth.users on conflict do nothing;

drop policy if exists "profiles read" on public.profiles;
drop policy if exists "profiles owner update" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using (user_id = auth.uid() or public.is_manager());
create policy "profiles owner update" on public.profiles for update to authenticated using (public.my_role() = 'owner') with check (public.my_role() = 'owner');

-- Finances: owner and managers only
do $$
declare t text;
begin
  foreach t in array array['sales_days','costs','credits','staff','hr_events','hr_paid'] loop
    execute format('drop policy if exists "signed in users" on public.%I', t);
    execute format('drop policy if exists "managers only" on public.%I', t);
    execute format('create policy "managers only" on public.%I for all to authenticated using (public.is_manager()) with check (public.is_manager())', t);
  end loop;
end $$;
drop policy if exists "invoices signed in read" on storage.objects;
drop policy if exists "invoices signed in write" on storage.objects;
drop policy if exists "invoices signed in delete" on storage.objects;
drop policy if exists "invoices managers read" on storage.objects;
drop policy if exists "invoices managers write" on storage.objects;
drop policy if exists "invoices managers delete" on storage.objects;
create policy "invoices managers read" on storage.objects for select to authenticated using (bucket_id = 'invoices' and public.is_manager());
create policy "invoices managers write" on storage.objects for insert to authenticated with check (bucket_id = 'invoices' and public.is_manager());
create policy "invoices managers delete" on storage.objects for delete to authenticated using (bucket_id = 'invoices' and public.is_manager());

-- ---------- Guests / reservations / visits ----------
-- phone number → one key, so 0612345678, +212 612 345 678 and 00212612345678 are the same guest
create or replace function public.phone_key(p text) returns text
language sql immutable as $$
  select case
    when d is null or length(d) < 8 then null
    when left(d, 2) = '00' then substr(d, 3)
    when left(d, 1) = '0' and length(d) = 10 then '212' || substr(d, 2)
    else d end
  from (select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '') as d) s
$$;

create or replace function public.new_ref() returns text
language plpgsql volatile as $$
declare r text; chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  loop
    r := 'C-';
    for i in 1..6 loop r := r || substr(chars, 1 + floor(random() * 32)::int, 1); end loop;
    exit when not exists (select 1 from public.reservations where ref = r);
  end loop;
  return r;
end $$;

create table if not exists public.guests (
  id uuid primary key default gen_random_uuid(),
  phone_key text unique,
  name text not null default '',
  phone text,
  email text,
  status text not null default 'new' check (status in ('new','regular','vip','blocked')),
  status_manual boolean not null default false,
  notes text,
  birthday date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  ref text unique not null,
  guest_id uuid references public.guests(id) on delete set null,
  date date not null,
  time text not null,
  guests integer not null check (guests between 1 and 60),
  name text not null,
  phone text,
  email text,
  notes text,
  status text not null default 'pending' check (status in ('pending','confirmed','seated','done','cancelled','no-show')),
  table_no text,
  source text not null default 'web' check (source in ('web','phone','walkin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reservations_date_idx on public.reservations (date);
create index if not exists reservations_guest_idx on public.reservations (guest_id);

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid references public.guests(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete set null,
  date date not null,
  table_no text,
  covers integer,
  amount numeric not null default 0,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists visits_guest_idx on public.visits (guest_id);
create index if not exists visits_date_idx on public.visits (date);

do $$
declare t text;
begin
  foreach t in array array['guests','reservations','visits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "staff read" on public.%I', t);
    execute format('drop policy if exists "staff insert" on public.%I', t);
    execute format('drop policy if exists "staff update" on public.%I', t);
    execute format('drop policy if exists "managers delete" on public.%I', t);
    execute format('create policy "staff read" on public.%I for select to authenticated using (public.is_staff())', t);
    execute format('create policy "staff insert" on public.%I for insert to authenticated with check (public.is_staff())', t);
    execute format('create policy "staff update" on public.%I for update to authenticated using (public.is_staff()) with check (public.is_staff())', t);
    execute format('create policy "managers delete" on public.%I for delete to authenticated using (public.is_manager())', t);
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Find or create a guest by phone (staff only)
create or replace function public.upsert_guest(p_name text, p_phone text, p_email text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare k text; gid uuid;
begin
  if not public.is_staff() then raise exception 'not allowed'; end if;
  k := public.phone_key(p_phone);
  if k is null then
    insert into public.guests (name, phone, email) values (left(coalesce(trim(p_name), ''), 80), nullif(left(coalesce(p_phone, ''), 30), ''), nullif(left(coalesce(p_email, ''), 120), '')) returning id into gid;
    return gid;
  end if;
  insert into public.guests (phone_key, name, phone, email)
  values (k, left(coalesce(trim(p_name), ''), 80), left(p_phone, 30), nullif(left(coalesce(p_email, ''), 120), ''))
  on conflict (phone_key) do update
    set name = case when public.guests.name = '' then excluded.name else public.guests.name end,
        email = coalesce(excluded.email, public.guests.email),
        updated_at = now()
  returning id into gid;
  return gid;
end $$;
revoke all on function public.upsert_guest(text, text, text) from public, anon;
grant execute on function public.upsert_guest(text, text, text) to authenticated;

-- Booking from the website (no login): validates, links to the guest, returns the reference only
create or replace function public.create_reservation(p_date date, p_time text, p_guests int, p_name text, p_phone text, p_email text default null, p_notes text default null) returns text
language plpgsql security definer set search_path = public as $$
declare k text; gid uuid; r text; today date := (now() at time zone 'Africa/Casablanca')::date;
begin
  if p_date < today - 1 or p_date > today + 91 then raise exception 'invalid date'; end if;
  if p_guests is null or p_guests < 1 or p_guests > 12 then raise exception 'invalid guests'; end if;
  if p_time is null or p_time !~ '^[0-2][0-9]:[0-5][0-9]$' then raise exception 'invalid time'; end if;
  if length(coalesce(trim(p_name), '')) = 0 then raise exception 'invalid name'; end if;
  k := public.phone_key(p_phone);
  if k is null then raise exception 'invalid phone'; end if;
  insert into public.guests (phone_key, name, phone, email)
  values (k, left(trim(p_name), 80), left(p_phone, 30), nullif(left(coalesce(p_email, ''), 120), ''))
  on conflict (phone_key) do update
    set email = coalesce(excluded.email, public.guests.email), updated_at = now()
  returning id into gid;
  r := public.new_ref();
  insert into public.reservations (ref, guest_id, date, time, guests, name, phone, email, notes, source)
  values (r, gid, p_date, p_time, p_guests, left(trim(p_name), 80), left(p_phone, 30),
          nullif(left(coalesce(p_email, ''), 120), ''), nullif(left(coalesce(p_notes, ''), 500), ''), 'web');
  return r;
end $$;
revoke all on function public.create_reservation(date, text, int, text, text, text, text) from public;
grant execute on function public.create_reservation(date, text, int, text, text, text, text) to anon, authenticated;
