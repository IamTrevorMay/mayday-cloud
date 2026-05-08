-- Folder-level visibility restrictions
-- Admins can block member/viewer roles from seeing specific folders (and their children).

create table if not exists folder_restrictions (
  id uuid primary key default gen_random_uuid(),
  folder_path text not null,
  blocked_role text not null check (blocked_role in ('member', 'viewer')),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(),
  unique (folder_path, blocked_role)
);

create index idx_folder_restrictions_path on folder_restrictions (folder_path);
create index idx_folder_restrictions_role on folder_restrictions (blocked_role);

-- RLS: only admins can read/write
alter table folder_restrictions enable row level security;

create policy "Admins can read folder_restrictions"
  on folder_restrictions for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

create policy "Admins can insert folder_restrictions"
  on folder_restrictions for insert
  with check (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

create policy "Admins can delete folder_restrictions"
  on folder_restrictions for delete
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );
