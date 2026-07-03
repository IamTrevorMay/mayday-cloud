-- Fix infinite recursion in the profiles admin-read policy.
--
-- The original policy subqueried public.profiles from within a policy ON
-- public.profiles, which Postgres rejects at evaluation time with
-- 42P17 "infinite recursion detected in policy for relation profiles".
-- Because permissive policies are OR-evaluated, this could error even the
-- plain "read own profile" path for any client querying profiles with the
-- anon key + user JWT. The API masks it today by using the service-role key
-- (which bypasses RLS), but it is a latent defect for direct-client reads.
--
-- Move the admin check into a SECURITY DEFINER helper. Its internal select
-- runs as the function owner and bypasses RLS, so there is no recursion.

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles" on public.profiles
  for select using (public.is_admin());
