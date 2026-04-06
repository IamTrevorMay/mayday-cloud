-- Favorites table
create table public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  file_path text not null,
  created_at timestamptz not null default now(),
  unique (user_id, file_path)
);

alter table public.favorites enable row level security;

create policy "Users can manage own favorites" on public.favorites
  for all using (auth.uid() = user_id);

create index idx_favorites_user_id on public.favorites(user_id);
