-- Auto-finance details: structured lender approvals, vehicle and trade-in, and a conditions checklist.
-- Adds columns and one table. Existing data is kept as it is.

-- ───────────── Lender approvals: amount, rate, term, payment ─────────────
alter table public.lender_submissions
  add column amount numeric(12,2) check (amount is null or amount between 0 and 1000000),
  add column rate numeric(5,2) check (rate is null or rate between 0 and 60),
  add column term_months int check (term_months is null or term_months between 6 and 120),
  add column payment numeric(10,2) check (payment is null or payment between 0 and 100000),
  add column payment_freq text check (payment_freq is null or payment_freq in ('monthly','biweekly','weekly'));

-- TJ or Sam fill in what the lender offered. The old free-text terms stay as notes.
create or replace function public.set_lender_terms(
  p_submission bigint, p_amount numeric, p_rate numeric, p_term int,
  p_payment numeric, p_freq text, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.lender_submissions;
  d public.deals;
begin
  if public.my_role() is null or public.my_role() not in ('admin','lead') then
    raise exception 'Only TJ or Sam can update lender decisions.';
  end if;
  select * into s from public.lender_submissions where id = p_submission for update;
  if not found then raise exception 'Lender not found.'; end if;
  select * into d from public.deals where id = s.deal_id;
  if d.stage in ('closed','declined','lost') then raise exception 'This deal is no longer open.'; end if;
  update public.lender_submissions
     set amount = p_amount, rate = p_rate, term_months = p_term, payment = p_payment,
         payment_freq = nullif(p_freq, ''), terms = nullif(trim(coalesce(p_notes, '')), ''), updated_at = now()
   where id = p_submission;
end $$;
revoke execute on function public.set_lender_terms(bigint, numeric, numeric, int, numeric, text, text) from public, anon;
grant execute on function public.set_lender_terms(bigint, numeric, numeric, int, numeric, text, text) to authenticated;

-- ───────────── Vehicle and trade-in ─────────────
alter table public.deals
  add column vehicle_year int check (vehicle_year is null or vehicle_year between 1980 and 2100),
  add column vehicle_make text check (vehicle_make is null or length(vehicle_make) <= 40),
  add column vehicle_model text check (vehicle_model is null or length(vehicle_model) <= 60),
  add column vehicle_trim text check (vehicle_trim is null or length(vehicle_trim) <= 60),
  add column vehicle_km int check (vehicle_km is null or vehicle_km between 0 and 2000000),
  add column vin text check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  add column down_payment numeric(12,2) check (down_payment is null or down_payment between 0 and 1000000),
  add column trade_in_desc text check (trade_in_desc is null or length(trade_in_desc) <= 120),
  add column trade_in_value numeric(12,2) check (trade_in_value is null or trade_in_value between 0 and 1000000);

-- Agents can now fill in the vehicle and trade-in on their own deals.
-- The vehicle price and the dealer stay with TJ and Sam.
create or replace function public.deals_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.via_rpc', true), '') <> 'on' then
    if new.stage is distinct from old.stage
       or new.prev_stage is distinct from old.prev_stage
       or new.lost_reason is distinct from old.lost_reason
       or new.agent_id is distinct from old.agent_id
       or new.stage_changed_at is distinct from old.stage_changed_at
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Use the stage buttons to move or reassign deals.';
    end if;
    if public.my_role() = 'agent' then
      if new.vehicle_price is distinct from old.vehicle_price
         or new.dealer is distinct from old.dealer then
        raise exception 'Only TJ or Sam can set the vehicle price and dealer.';
      end if;
      if old.stage in ('closed','declined') then raise exception 'This deal is final.'; end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ───────────── Conditions checklist ─────────────
create table public.deal_conditions (
  id bigint generated always as identity primary key,
  deal_id bigint not null references public.deals (id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 120),
  done_at timestamptz,
  done_by uuid references public.profiles (id),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index deal_conditions_deal_idx on public.deal_conditions (deal_id);
alter table public.deal_conditions enable row level security;

-- Anyone who can see the deal sees its checklist and can add to it while the deal is open.
-- Ticking goes through toggle_condition so it records who and when.
create or replace function public.deal_is_open(p_deal bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.deals where id = p_deal and stage not in ('closed','declined','lost'))
$$;
create policy deal_conditions_read on public.deal_conditions for select to authenticated
  using (public.can_see_deal(deal_id));
create policy deal_conditions_add on public.deal_conditions for insert to authenticated
  with check (public.can_see_deal(deal_id) and public.deal_is_open(deal_id)
              and created_by = auth.uid() and done_at is null and done_by is null);
-- Remove an item: TJ or Sam any time, or whoever added it while it's still unticked.
create policy deal_conditions_remove on public.deal_conditions for delete to authenticated
  using (public.can_see_deal(deal_id) and public.deal_is_open(deal_id)
         and (public.my_role() in ('admin','lead') or (created_by = auth.uid() and done_at is null)));

create or replace function public.toggle_condition(p_id bigint, p_done boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.deal_conditions;
  d public.deals;
begin
  select * into c from public.deal_conditions where id = p_id for update;
  if not found or not public.can_see_deal(c.deal_id) then raise exception 'Condition not found.'; end if;
  select * into d from public.deals where id = c.deal_id;
  if d.stage in ('closed','declined','lost') then raise exception 'This deal is no longer open.'; end if;
  if p_done = (c.done_at is not null) then return; end if;
  update public.deal_conditions
     set done_at = case when p_done then now() end, done_by = case when p_done then auth.uid() end
   where id = p_id;
  perform public.log_event(c.deal_id,
    public.actor_name() || case when p_done then ' ticked off ' else ' unticked ' end || c.label, d.agent_id);
end $$;
revoke execute on function public.toggle_condition(bigint, boolean) from public, anon;
grant execute on function public.toggle_condition(bigint, boolean) to authenticated;

alter publication supabase_realtime add table public.deal_conditions;
