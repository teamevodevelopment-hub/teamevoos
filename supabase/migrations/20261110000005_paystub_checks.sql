-- Paystub Verifier history: every check is saved so TJ (who submits to the banks) can see them all.
-- Only the summary (what was read and the maths) is kept. The pay stub files themselves are never stored.
--
-- Who sees a check:  whoever ran it; TJ and Sam (admin, lead) see every check;
--                    and anyone who can see the deal it's attached to.
-- Who can delete:    whoever ran it, or TJ.

create table public.paystub_checks (
  id bigint generated always as identity primary key,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  deal_id bigint references public.deals (id) on delete set null,
  employee_name text check (length(employee_name) <= 200),
  employer_name text check (length(employer_name) <= 200),
  stub_count int not null check (stub_count between 1 and 8),
  latest_pay_date date,
  hourly numeric(12, 4),
  annual40 numeric(12, 2),
  warn_count int not null default 0 check (warn_count >= 0),
  -- The full report the app shows (what Claude read, plus our maths and checks).
  report jsonb not null check (jsonb_typeof(report) = 'object' and octet_length(report::text) < 300000)
);
create index paystub_checks_recent_idx on public.paystub_checks (created_at desc);
create index paystub_checks_deal_idx on public.paystub_checks (deal_id) where deal_id is not null;

alter table public.paystub_checks enable row level security;

create policy paystub_checks_read on public.paystub_checks for select to authenticated
  using (
    created_by = auth.uid()
    or public.my_role() in ('admin', 'lead')
    or (deal_id is not null and public.can_see_deal(deal_id))
  );

-- You save your own checks, and can only attach them to a deal you can see.
create policy paystub_checks_add on public.paystub_checks for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.my_role() is not null
    and (deal_id is null or public.can_see_deal(deal_id))
  );

create policy paystub_checks_remove on public.paystub_checks for delete to authenticated
  using (created_by = auth.uid() or public.my_role() = 'admin');

-- No direct edits. The one change allowed is attaching (or detaching) a deal, through this.
create or replace function public.set_paystub_deal(p_id bigint, p_deal bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.paystub_checks;
begin
  select * into c from public.paystub_checks where id = p_id;
  if c.id is null or not (c.created_by = auth.uid() or public.my_role() in ('admin', 'lead')) then
    raise exception 'You can only attach your own paystub checks.';
  end if;
  if p_deal is not null and not public.can_see_deal(p_deal) then
    raise exception 'You can only attach it to a deal you can see.';
  end if;
  update public.paystub_checks set deal_id = p_deal where id = p_id;
  if p_deal is not null then
    perform public.log_event(
      p_deal,
      public.actor_name() || ' attached a paystub check'
        || coalesce(' for ' || c.employee_name, '')
        || coalesce(' (' || to_char(c.annual40, 'FM$999,999,999') || '/yr at 40 h)', '')
    );
  end if;
end $$;

revoke all on function public.set_paystub_deal(bigint, bigint) from public, anon;
grant execute on function public.set_paystub_deal(bigint, bigint) to authenticated;
grant select, insert, delete on public.paystub_checks to authenticated;
