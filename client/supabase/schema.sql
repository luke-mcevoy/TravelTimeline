-- TravelTimeline social backend — run this in the Supabase SQL editor.
-- Safe to re-run: everything is guarded with "if not exists" / "drop ... if exists".
--
-- Model
--   profiles     one row per user; public-readable (powers search + global
--                leaderboard); holds denormalized stats so the leaderboard is a
--                single cheap query.
--   places       a user's derived travel history (one row per visited place).
--                Readable by the owner and their ACCEPTED friends only.
--   friendships  mutual friend graph (requester -> addressee, pending/accepted).
--   storage      'heroes' bucket holds one small hero thumbnail per place.

-- ─── Tables ──────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  handle          text unique not null,
  display_name    text,
  avatar_url      text,
  home_country    text,
  countries_count integer not null default 0,
  cities_count    integer not null default 0,
  places_count    integer not null default 0,
  distance_km     double precision not null default 0,
  last_synced_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint handle_format check (handle ~ '^[a-z0-9_]{3,20}$')
);

create table if not exists public.places (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  place_key    text not null,            -- stable per user+location (for upsert)
  city         text,
  country      text,
  country_code text,
  lat          double precision not null,
  lng          double precision not null,
  arrival      date,
  departure    date,
  photo_count  integer not null default 0,
  hero_path    text,                     -- path in the 'heroes' storage bucket
  created_at   timestamptz not null default now(),
  unique (user_id, place_key)
);
create index if not exists places_user_idx on public.places (user_id);

create table if not exists public.friendships (
  id         uuid primary key default gen_random_uuid(),
  requester  uuid not null references auth.users (id) on delete cascade,
  addressee  uuid not null references auth.users (id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requester, addressee),
  check (requester <> addressee)
);
create index if not exists friendships_addressee_idx on public.friendships (addressee);

-- ─── Friendship helper (used by RLS) ─────────────────────────────────
-- SECURITY DEFINER so the places policy can check friendship without the
-- caller needing direct read access to every friendships row.

create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester = a and f.addressee = b)
        or (f.requester = b and f.addressee = a))
  );
$$;

-- ─── Row Level Security ──────────────────────────────────────────────

alter table public.profiles    enable row level security;
alter table public.places      enable row level security;
alter table public.friendships enable row level security;

-- profiles: world-readable (search + global leaderboard); self-writable.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- places: owner + accepted friends can read; only owner can write.
drop policy if exists places_read on public.places;
create policy places_read on public.places for select
  using (user_id = auth.uid() or public.are_friends(auth.uid(), user_id));

drop policy if exists places_write on public.places;
create policy places_write on public.places
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- friendships: only the two parties can see/manage their edge.
drop policy if exists friendships_read on public.friendships;
create policy friendships_read on public.friendships for select
  using (auth.uid() in (requester, addressee));

drop policy if exists friendships_insert on public.friendships;
create policy friendships_insert on public.friendships
  for insert with check (requester = auth.uid());

drop policy if exists friendships_update on public.friendships;
create policy friendships_update on public.friendships
  for update using (auth.uid() in (requester, addressee));

drop policy if exists friendships_delete on public.friendships;
create policy friendships_delete on public.friendships
  for delete using (auth.uid() in (requester, addressee));

-- ─── updated_at trigger ──────────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists friendships_touch on public.friendships;
create trigger friendships_touch before update on public.friendships
  for each row execute function public.touch_updated_at();

-- ─── Storage: hero thumbnails ────────────────────────────────────────
-- Public-read bucket (small auto-picked thumbnails, unguessable uuid paths).
-- Writes are restricted to each user's own folder: heroes/<uid>/<place>.jpg

insert into storage.buckets (id, name, public)
values ('heroes', 'heroes', true)
on conflict (id) do nothing;

drop policy if exists heroes_read on storage.objects;
create policy heroes_read on storage.objects for select
  using (bucket_id = 'heroes');

drop policy if exists heroes_write_own on storage.objects;
create policy heroes_write_own on storage.objects for insert
  with check (bucket_id = 'heroes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists heroes_update_own on storage.objects;
create policy heroes_update_own on storage.objects for update
  using (bucket_id = 'heroes' and (storage.foldername(name))[1] = auth.uid()::text);
