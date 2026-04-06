-- Mayday Cloud initial schema

-- Profiles (auto-created on signup)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'member' check (role in ('admin', 'member', 'viewer')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can read own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "Admins can read all profiles" on public.profiles
  for select using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Share links
create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  target_path text not null,
  mode text not null default 'upload' check (mode in ('upload', 'download', 'both')),
  max_uses int,
  used_count int not null default 0,
  expires_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.share_links enable row level security;

create policy "Users can manage own share links" on public.share_links
  for all using (auth.uid() = created_by);

-- API keys (for desktop sync client, Phase 5)
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  key_hash text unique not null,
  key_prefix text not null, -- first 8 chars for display
  scoped_path text, -- optional folder scope
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table public.api_keys enable row level security;

create policy "Users can manage own API keys" on public.api_keys
  for all using (auth.uid() = user_id);

-- Index for fast token lookups
create index idx_share_links_token on public.share_links(token);
create index idx_api_keys_key_hash on public.api_keys(key_hash);
