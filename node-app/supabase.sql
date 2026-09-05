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
  alt_text text not null default 'BFIMPC portfolio image',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Public legal document images, uploaded through the admin content manager.
create table if not exists public.legal_documents (
  id bigint generated always as identity primary key,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '',
  file_url text not null,
  file_name text not null,
  created_at timestamptz not null default now()
);

-- Additional images for portfolio posts and legal documents.
create table if not exists public.portfolio_item_images (
  id bigint generated always as identity primary key,
  portfolio_item_id bigint not null references public.portfolio_items(id) on delete cascade,
  image_url text not null,
  alt_text text not null default 'BFIMPC portfolio image',
  created_at timestamptz not null default now()
);

create table if not exists public.legal_document_images (
  id bigint generated always as identity primary key,
  legal_document_id bigint not null references public.legal_documents(id) on delete cascade,
  image_url text not null,
  created_at timestamptz not null default now()
);

-- The main record already stores the first image. Remove matching legacy copies
-- from the additional-image tables so galleries do not repeat that first image.
delete from public.portfolio_item_images additional
using public.portfolio_items item
where additional.portfolio_item_id = item.id
  and additional.image_url = item.image_url;

delete from public.legal_document_images additional
using public.legal_documents document
where additional.legal_document_id = document.id
  and additional.image_url = document.file_url;

-- Affiliate/partner directory. Logos are public URLs from the existing
-- bfimpc-content storage bucket and are managed by administrators only.
create table if not exists public.affiliates (
  id bigint generated always as identity primary key,
  company_name text not null check (char_length(btrim(company_name)) between 1 and 160),
  logo_url text not null check (char_length(btrim(logo_url)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists affiliates_created_at_idx on public.affiliates (created_at asc, id asc);

create table if not exists public.contact_messages (
  id bigint generated always as identity primary key,
  name text not null,
  email text not null,
  subject text not null,
  message text not null,
  created_at timestamptz not null default now()
);

-- Membership ID applications are private to the applicant and administrators.
create table if not exists public.membership_applications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_name text not null, first_name text not null, middle_name text not null default '',
  street text not null, barangay text not null, municipality text not null, province text not null, zip_code text not null,
  birthdate date not null, sex text not null check (sex in ('Male', 'Female')), tin_sss text not null default '',
  marital_status text not null default '', spouse_name text not null default '', spouse_birthdate date,
  phone text not null, email text not null, occupation_employer text not null default '',
  emergency_last_name text not null, emergency_first_name text not null, emergency_middle_name text not null default '',
  emergency_street text not null, emergency_barangay text not null, emergency_municipality text not null, emergency_province text not null, emergency_zip_code text not null, emergency_phone text not null,
  primary_beneficiary_name text not null default '', primary_beneficiary_birthdate date, primary_beneficiary_relationship text not null default '',
  secondary_beneficiary_name text not null default '', secondary_beneficiary_birthdate date, secondary_beneficiary_relationship text not null default '',
  photo_path text not null,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
alter table public.staff enable row level security;
alter table public.portfolio_items enable row level security;
alter table public.legal_documents enable row level security;
alter table public.portfolio_item_images enable row level security;
alter table public.legal_document_images enable row level security;
alter table public.affiliates enable row level security;
alter table public.contact_messages enable row level security;
alter table public.membership_applications enable row level security;

drop trigger if exists set_affiliates_updated_at on public.affiliates;
create trigger set_affiliates_updated_at
  before update on public.affiliates
  for each row execute procedure public.set_updated_at();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.staff where user_id = auth.uid()) $$;

-- Public images uploaded by administrators for portfolio content.
insert into storage.buckets (id, name, public)
values ('bfimpc-content', 'bfimpc-content', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('membership-photos', 'membership-photos', false)
on conflict (id) do update set public = false;

drop policy if exists "Anyone can view BFIMPC content images" on storage.objects;
create policy "Anyone can view BFIMPC content images" on storage.objects for select using (bucket_id = 'bfimpc-content');
drop policy if exists "Admins upload BFIMPC content images" on storage.objects;
create policy "Admins upload BFIMPC content images" on storage.objects for insert to authenticated with check (bucket_id = 'bfimpc-content' and public.is_admin());
drop policy if exists "Members upload their membership photo" on storage.objects;
create policy "Members upload their membership photo" on storage.objects for insert to authenticated with check (bucket_id = 'membership-photos' and owner_id = (select auth.uid()::text));
drop policy if exists "Members and admins can view membership photos" on storage.objects;
create policy "Members and admins can view membership photos" on storage.objects for select to authenticated using (bucket_id = 'membership-photos' and (owner_id = (select auth.uid()::text) or public.is_admin()));
drop policy if exists "Admins delete membership photos" on storage.objects;
create policy "Admins delete membership photos" on storage.objects for delete to authenticated using (bucket_id = 'membership-photos' and public.is_admin());

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
drop policy if exists "Anyone can view portfolio images" on public.portfolio_item_images;
create policy "Anyone can view portfolio images" on public.portfolio_item_images for select using (true);
drop policy if exists "Admins manage portfolio images" on public.portfolio_item_images;
create policy "Admins manage portfolio images" on public.portfolio_item_images for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Anyone can view legal documents" on public.legal_documents;
create policy "Anyone can view legal documents" on public.legal_documents for select using (true);
drop policy if exists "Admins manage legal documents" on public.legal_documents;
create policy "Admins manage legal documents" on public.legal_documents for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Anyone can view legal document images" on public.legal_document_images;
create policy "Anyone can view legal document images" on public.legal_document_images for select using (true);
drop policy if exists "Admins manage legal document images" on public.legal_document_images;
create policy "Admins manage legal document images" on public.legal_document_images for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Anyone can view affiliates" on public.affiliates;
create policy "Anyone can view affiliates" on public.affiliates for select using (true);
drop policy if exists "Admins manage affiliates" on public.affiliates;
create policy "Admins manage affiliates" on public.affiliates for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Staff manage portfolio items" on public.portfolio_items;
create policy "Staff manage portfolio items" on public.portfolio_items for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "Staff manage portfolio images" on public.portfolio_item_images;
create policy "Staff manage portfolio images" on public.portfolio_item_images for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "Anyone can submit contact messages" on public.contact_messages;
create policy "Anyone can submit contact messages" on public.contact_messages for insert to anon, authenticated with check (true);
drop policy if exists "Admins view contact messages" on public.contact_messages;
create policy "Admins view contact messages" on public.contact_messages for select to authenticated using (public.is_admin());
drop policy if exists "Staff view contact messages" on public.contact_messages;
create policy "Staff view contact messages" on public.contact_messages for select to authenticated using (public.is_staff());
drop policy if exists "Users submit their membership application" on public.membership_applications;
create policy "Users submit their membership application" on public.membership_applications for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Users view their membership applications" on public.membership_applications;
create policy "Users view their membership applications" on public.membership_applications for select to authenticated using (user_id = auth.uid());
drop policy if exists "Admins view membership applications" on public.membership_applications;
create policy "Admins view membership applications" on public.membership_applications for select to authenticated using (public.is_admin());
drop policy if exists "Admins delete membership applications" on public.membership_applications;
create policy "Admins delete membership applications" on public.membership_applications for delete to authenticated using (public.is_admin());

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

-- Deletes a membership record only when performed by an administrator. Returning
-- the private photo path lets the application remove the associated upload too.
create or replace function public.delete_membership_application(target_application_id bigint)
returns text language plpgsql security definer set search_path = public
as $$
declare deleted_photo_path text;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  delete from public.membership_applications
  where id = target_application_id
  returning photo_path into deleted_photo_path;
  if deleted_photo_path is null then raise exception 'Membership application was not found'; end if;
  return deleted_photo_path;
end;
$$;

grant execute on function public.add_admin_by_email(text) to authenticated;
grant execute on function public.remove_admin(uuid) to authenticated;
grant execute on function public.add_staff_by_email(text) to authenticated;
grant execute on function public.remove_staff(uuid) to authenticated;
grant execute on function public.list_user_accounts() to authenticated;
grant execute on function public.delete_user_account(uuid) to authenticated;
grant execute on function public.delete_membership_application(bigint) to authenticated;

-- Make the new membership deletion RPC immediately visible to Supabase's REST API.
notify pgrst, 'reload schema';

do $seed$
begin
  if not exists (select 1 from public.portfolio_items) then
    insert into public.portfolio_items (title, caption, image_url, alt_text, sort_order) values
      ($$The BFIMPC Beginning$$, $$Small beginnings, moving forward together and building a better future for generations to nurture.$$, $$/assets/img/portfolio/image-2.jpg$$, $$BFIMPC early community moment$$, 1),
      ($$Five Years Together$$, $$Brilliant ideas and lasting friendships as BFIMPC celebrated its fifth year.$$, $$/assets/img/portfolio/image-1.jpg$$, $$BFIMPC anniversary gathering$$, 2),
      ($$Lucky Number Eight$$, $$Growing stronger, building dreams, and creating happy memories together.$$, $$/assets/img/portfolio/image-3.jpg$$, $$BFIMPC Lucky Number Eight group$$, 3),
      ($$Dreaming Into Doing$$, $$Every meaningful goal begins with the choice to take action.$$, $$/assets/img/portfolio/image-4.jpg$$, $$BFIMPC members at an event$$, 4),
      ($$Going Further Together$$, $$We move farther when we show up for one another.$$, $$/assets/img/portfolio/image-5.jpg$$, $$BFIMPC community activity$$, 5),
      ($$Shared Moments$$, $$Making space for connection, celebration, and community.$$, $$/assets/img/portfolio/image-6.jpg$$, $$BFIMPC shared moment$$, 6),
      ($$Growing Together$$, $$One cooperative, many stories, and a shared future.$$, $$/assets/img/portfolio/image-7.jpg$$, $$BFIMPC members together$$, 7),
      ($$Building Dreams$$, $$Working side by side to make family goals feel possible.$$, $$/assets/img/portfolio/image-8.jpg$$, $$BFIMPC community gathering$$, 8),
      ($$Stronger Communities$$, $$Progress is more meaningful when it is shared.$$, $$/assets/img/portfolio/image-9.jpg$$, $$BFIMPC group milestone$$, 9),
      ($$Family Legacy$$, $$Creating a future the next generation can be proud to nurture.$$, $$/assets/img/portfolio/image-10.jpg$$, $$BFIMPC family legacy moment$$, 10);
  end if;
end;
$seed$;

-- Preserve the affiliate partners currently displayed on the public site.
-- New records added from Admin → Affiliate partners are stored alongside them.
do $seed_affiliates$
begin
  if not exists (select 1 from public.affiliates) then
    insert into public.affiliates (company_name, logo_url) values
      ('Punchy Palate Gastropub', '/assets/img/affiliates/punchypalategastropub.png'),
      ('MRJP Gold Trading', '/assets/img/affiliates/MRJPGoldTrading.png'),
      ('Marojesper Apartments', '/assets/img/affiliates/MarojecperApartmetns.png'),
      ('MRJP International Immigration Services', '/assets/img/affiliates/MRJPINternationalImmigrationServices.png'),
      ('Online Shop Hanacraezedic', '/assets/img/affiliates/Online%20Shop%20Hanacraezedic%20.png'),
      ('Loyosen’s Enterprise', '/assets/img/affiliates/%2BLoyosen%E2%80%99s%20Enterprise.png'),
      ('Symonah’s House of Apparel', '/assets/img/affiliates/Symonah%E2%80%99s%20House%20of%20Apparel.png'),
      ('Skye Dental Clinic', '/assets/img/affiliates/Skye%20Dental%20Clinic.png'),
      ('Dr. Carame Porification Dental Clinic', '/assets/img/BFI_logo.png'),
      ('Dr. Brenda S. Cirilo Family Physician', '/assets/img/affiliates/Dr.%20Brenda%20S.%20CiriloFamily%20Physician.png'),
      ('General Pediatrician Clinic', '/assets/img/affiliates/General%20Pediatrician%20Clinic.png'),
      ('Atty. Cita Fango-ok Pakeo', '/assets/img/affiliates/Atty.%20Cita%20Fango-ok%20Pakeo%20%20.png'),
      ('Office of the Vice Mayor', '/assets/img/BFI_logo.png');
  end if;
end;
$seed_affiliates$;

-- Grant the BFIMPC administrator account access. This is safe to rerun after the
-- account has signed up; it does nothing until the matching Auth user exists.
insert into public.admins (user_id, email)
select id, lower(email) from auth.users where lower(email) = 'adminbfimpc@gmail.com'
on conflict (user_id) do update set email = excluded.email;
