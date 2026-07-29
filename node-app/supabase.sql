-- Run this once in Supabase Dashboard → SQL Editor.
-- It creates one private profile row for every Supabase Auth user.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  birthdate date,
  gender text check (gender in ('Female', 'Male', 'Prefer not to say')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, first_name, last_name, birthdate, gender)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    nullif(new.raw_user_meta_data ->> 'birthdate', '')::date,
    nullif(new.raw_user_meta_data ->> 'gender', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- Admin area, portfolio posts, and contact inbox.
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.portfolio_items (
  id bigint generated always as identity primary key,
  title text not null,
  caption text not null,
  image_url text not null,
  alt_text text not null default 'BFIMC portfolio image',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.contact_messages (
  id bigint generated always as identity primary key,
  name text not null,
  email text not null,
  subject text not null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
alter table public.staff enable row level security;
alter table public.portfolio_items enable row level security;
alter table public.contact_messages enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.staff where user_id = auth.uid()) $$;

-- Public images uploaded by administrators for portfolio content.
insert into storage.buckets (id, name, public)
values ('bfimc-content', 'bfimc-content', true)
on conflict (id) do update set public = true;

drop policy if exists "Anyone can view BFIMC content images" on storage.objects;
create policy "Anyone can view BFIMC content images" on storage.objects for select using (bucket_id = 'bfimc-content');
drop policy if exists "Admins upload BFIMC content images" on storage.objects;
create policy "Admins upload BFIMC content images" on storage.objects for insert to authenticated with check (bucket_id = 'bfimc-content' and public.is_admin());

drop policy if exists "Admins can view their own role" on public.admins;
drop policy if exists "Admins can view administrators" on public.admins;
create policy "Admins can view administrators" on public.admins for select to authenticated using (public.is_admin());
drop policy if exists "Staff can view their own role" on public.staff;
drop policy if exists "Admins can view staff" on public.staff;
create policy "Staff can view their own role" on public.staff for select to authenticated using (user_id = auth.uid());
create policy "Admins can view staff" on public.staff for select to authenticated using (public.is_admin());
drop policy if exists "Anyone can view portfolio items" on public.portfolio_items;
create policy "Anyone can view portfolio items" on public.portfolio_items for select using (true);
drop policy if exists "Admins manage portfolio items" on public.portfolio_items;
create policy "Admins manage portfolio items" on public.portfolio_items for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Staff manage portfolio items" on public.portfolio_items;
create policy "Staff manage portfolio items" on public.portfolio_items for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "Anyone can submit contact messages" on public.contact_messages;
create policy "Anyone can submit contact messages" on public.contact_messages for insert to anon, authenticated with check (true);
drop policy if exists "Admins view contact messages" on public.contact_messages;
create policy "Admins view contact messages" on public.contact_messages for select to authenticated using (public.is_admin());
drop policy if exists "Staff view contact messages" on public.contact_messages;
create policy "Staff view contact messages" on public.contact_messages for select to authenticated using (public.is_staff());

create or replace function public.add_admin_by_email(target_email text)
returns void language plpgsql security definer set search_path = public, auth
as $$
declare target_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  select id into target_id from auth.users where lower(email) = lower(target_email);
  if target_id is null then raise exception 'No account exists for this email'; end if;
  insert into public.admins (user_id, email) values (target_id, lower(target_email)) on conflict (user_id) do nothing;
end;
$$;

create or replace function public.remove_admin(target_user_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  if target_user_id = auth.uid() then raise exception 'You cannot remove your own admin access'; end if;
  delete from public.admins where user_id = target_user_id;
end;
$$;

create or replace function public.add_staff_by_email(target_email text)
returns void language plpgsql security definer set search_path = public, auth
as $$
declare target_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  select id into target_id from auth.users where lower(email) = lower(target_email);
  if target_id is null then raise exception 'No account exists for this email'; end if;
  insert into public.staff (user_id, email) values (target_id, lower(target_email)) on conflict (user_id) do nothing;
end;
$$;

create or replace function public.remove_staff(target_user_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  delete from public.staff where user_id = target_user_id;
end;
$$;

create or replace function public.list_user_accounts()
returns table (user_id uuid, email text, first_name text, last_name text, created_at timestamptz, is_admin boolean)
language sql security definer set search_path = public, auth
as $$
  select u.id, lower(u.email),
    coalesce(p.first_name, u.raw_user_meta_data ->> 'first_name', ''),
    coalesce(p.last_name, u.raw_user_meta_data ->> 'last_name', ''),
    u.created_at,
    exists (select 1 from public.admins a where a.user_id = u.id)
  from auth.users u
  left join public.profiles p on p.id = u.id
  order by u.created_at desc;
$$;

create or replace function public.delete_user_account(target_user_id uuid)
returns void language plpgsql security definer set search_path = public, auth
as $$
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  if target_user_id = auth.uid() then raise exception 'You cannot delete your own account'; end if;
  delete from auth.users where id = target_user_id;
end;
$$;

grant execute on function public.add_admin_by_email(text) to authenticated;
grant execute on function public.remove_admin(uuid) to authenticated;
grant execute on function public.add_staff_by_email(text) to authenticated;
grant execute on function public.remove_staff(uuid) to authenticated;
grant execute on function public.list_user_accounts() to authenticated;
grant execute on function public.delete_user_account(uuid) to authenticated;

do $seed$
begin
  if not exists (select 1 from public.portfolio_items) then
    insert into public.portfolio_items (title, caption, image_url, alt_text, sort_order) values
      ($$The BFIMC Beginning$$, $$Small beginnings, moving forward together and building a better future for generations to nurture.$$, $$/assets/img/portfolio/image-2.jpg$$, $$BFIMC early community moment$$, 1),
      ($$Five Years Together$$, $$Brilliant ideas and lasting friendships as BFIMC celebrated its fifth year.$$, $$/assets/img/portfolio/image-1.jpg$$, $$BFIMC anniversary gathering$$, 2),
      ($$Lucky Number Eight$$, $$Growing stronger, building dreams, and creating happy memories together.$$, $$/assets/img/portfolio/image-3.jpg$$, $$BFIMC Lucky Number Eight group$$, 3),
      ($$Dreaming Into Doing$$, $$Every meaningful goal begins with the choice to take action.$$, $$/assets/img/portfolio/image-4.jpg$$, $$BFIMC members at an event$$, 4),
      ($$Going Further Together$$, $$We move farther when we show up for one another.$$, $$/assets/img/portfolio/image-5.jpg$$, $$BFIMC community activity$$, 5),
      ($$Shared Moments$$, $$Making space for connection, celebration, and community.$$, $$/assets/img/portfolio/image-6.jpg$$, $$BFIMC shared moment$$, 6),
      ($$Growing Together$$, $$One cooperative, many stories, and a shared future.$$, $$/assets/img/portfolio/image-7.jpg$$, $$BFIMC members together$$, 7),
      ($$Building Dreams$$, $$Working side by side to make family goals feel possible.$$, $$/assets/img/portfolio/image-8.jpg$$, $$BFIMC community gathering$$, 8),
      ($$Stronger Communities$$, $$Progress is more meaningful when it is shared.$$, $$/assets/img/portfolio/image-9.jpg$$, $$BFIMC group milestone$$, 9),
      ($$Family Legacy$$, $$Creating a future the next generation can be proud to nurture.$$, $$/assets/img/portfolio/image-10.jpg$$, $$BFIMC family legacy moment$$, 10);
  end if;
end;
$seed$;

-- Grant the BFIMC administrator account access. This is safe to rerun after the
-- account has signed up; it does nothing until the matching Auth user exists.
insert into public.admins (user_id, email)
select id, lower(email) from auth.users where lower(email) = 'adminbfimc@gmail.com'
on conflict (user_id) do update set email = excluded.email;
