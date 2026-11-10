-- Two-step verification is no longer required (TJ's decision, 2026-11-10).
-- Signed-in team members get their role straight away. Every other rule stays the same.
create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;
