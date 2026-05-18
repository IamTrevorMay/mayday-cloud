-- Per-user folder visibility restrictions
-- Admins can block specific individual users from seeing folders (and their children).

create table if not exists user_folder_restrictions (
  id uuid primary key default gen_random_uuid(),
  folder_path text not null,
  user_id uuid not null references profiles(id) on delete cascade,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(),
  unique (folder_path, user_id)
);

create index idx_user_folder_restrictions_path on user_folder_restrictions (folder_path);

-- RLS: only admins can read/write
alter table user_folder_restrictions enable row level security;

create policy "Admins can read user_folder_restrictions"
  on user_folder_restrictions for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

create policy "Admins can insert user_folder_restrictions"
  on user_folder_restrictions for insert
  with check (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

create policy "Admins can delete user_folder_restrictions"
  on user_folder_restrictions for delete
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );
