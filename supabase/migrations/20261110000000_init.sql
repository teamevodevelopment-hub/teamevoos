-- Deal Portal: schema, access rules and stage rules.
-- Every permission in the spec is enforced here, in the database, not only in the app.
-- Roles: admin = TJ, lead = Sam, agent = Corbin and Ahmed.

create type public.app_role as enum ('admin', 'lead', 'agent');

-- ───────────────────────── Tables ─────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null unique,
  role public.app_role not null default 'agent',
  created_at timestamptz not null default now()
);

create table public.lenders (
  id bigint generated always as identity primary key,
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.lost_reasons (
  id bigint generated always as identity primary key,
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.deals (
  id bigint generated always as identity primary key,
  first_name text not null check (length(trim(first_name)) > 0),
  last_name text not null check (length(trim(last_name)) > 0),
  phone text,
  email text,
  city text,
  agent_id uuid not null references public.profiles (id),
  stage text not null default 'new'
    check (stage in ('new','docs','ready','submitted','approved','car','closed','declined','lost')),
  prev_stage text,
  lost_reason text,
  dealertrack_no text,
  notes text,
  licence_front text,
  licence_back text,
  vehicle_desc text,
  vehicle_price numeric(12,2),
  dealer text,
  stage_changed_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deals_agent_idx on public.deals (agent_id);
create index deals_stage_idx on public.deals (stage);

create table public.lender_submissions (
  id bigint generated always as identity primary key,
  deal_id bigint not null references public.deals (id) on delete cascade,
  lender text not null,
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  terms text,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, lender)
);

create table public.messages (
  id bigint generated always as identity primary key,
  deal_id bigint not null references public.deals (id) on delete cascade,
  author_id uuid references public.profiles (id) default auth.uid(),
  kind text not null default 'user' check (kind in ('user','system')),
  body text not null check (length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index messages_deal_idx on public.messages (deal_id, created_at);

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  deal_id bigint references public.deals (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  kind text not null check (kind in ('mention','update')),
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.deal_events (
  id bigint generated always as identity primary key,
  deal_id bigint not null references public.deals (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  body text not null,
  created_at timestamptz not null default now()
);
create index deal_events_deal_idx on public.deal_events (deal_id, created_at desc);

create table public.licence_access_log (
  id bigint generated always as identity primary key,
  deal_id bigint references public.deals (id) on delete set null,
  user_id uuid references public.profiles (id),
  side text not null check (side in ('front','back')),
  created_at timestamptz not null default now()
);

create table public.feature_ideas (
  id bigint generated always as identity primary key,
  body text not null check (length(trim(body)) between 3 and 1000),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ───────────────────────── Helpers ─────────────────────────

-- The caller's role, but only once they have passed two-step verification (aal2).
-- Without 2FA this returns null, and every rule below then denies access.
create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles
  where id = auth.uid() and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create or replace function public.can_see_deal(p_deal bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.deals d
    where d.id = p_deal
      and (public.my_role() in ('admin','lead')
           or (public.my_role() = 'agent' and d.agent_id = auth.uid()))
  )
$$;

-- Storage paths look like "<deal id>/front-<timestamp>.jpg".
create or replace function public.can_see_licence_path(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_name ~ '^[0-9]+/'
    then public.can_see_deal(split_part(p_name, '/', 1)::bigint)
    else false end
$$;

create or replace function public.stage_name(p_stage text) returns text
language sql immutable as $$
  select case p_stage
    when 'new' then 'New lead' when 'docs' then 'Docs collected'
    when 'ready' then 'Ready to submit' when 'submitted' then 'Submitted to lenders'
    when 'approved' then 'Conditionally approved' when 'car' then 'Car selection'
    when 'closed' then 'Closed' when 'declined' then 'Declined' when 'lost' then 'Lost'
    else p_stage end
$$;

create or replace function public.actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select name from public.profiles where id = auth.uid()), 'Someone')
$$;

-- Writes the history line, the system line in the chat, and (optionally) one notification.
create or replace function public.log_event(p_deal bigint, p_text text, p_notify uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.deal_events (deal_id, actor_id, body) values (p_deal, auth.uid(), p_text);
  insert into public.messages (deal_id, author_id, kind, body) values (p_deal, auth.uid(), 'system', p_text);
  if p_notify is not null and p_notify is distinct from auth.uid() then
    insert into public.notifications (user_id, deal_id, actor_id, kind, body)
    values (p_notify, p_deal, auth.uid(), 'update', p_text);
  end if;
end $$;

-- ───────────────────────── Stage rules ─────────────────────────

create or replace function public.move_deal(p_deal bigint, p_to text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  d public.deals;
  r public.app_role := public.my_role();
  ok boolean := false;
  early text[] := array['new','docs','ready'];
  later text[] := array['submitted','approved','car','closed','declined'];
  txt text;
  nm text := public.actor_name();
  a record;
begin
  if r is null then raise exception 'Sign in with two-step verification first.'; end if;
  select * into d from public.deals where id = p_deal for update;
  if not found or not (r in ('admin','lead') or d.agent_id = auth.uid()) then
    raise exception 'Deal not found.';
  end if;
  if p_to = d.stage then return; end if;
  if p_to not in ('new','docs','ready','submitted','approved','car','closed','declined','lost') then
    raise exception 'Unknown stage.';
  end if;

  if d.stage in ('closed','declined') then
    raise exception '% deals are final.', public.stage_name(d.stage);
  elsif d.stage = 'lost' then
    if r in ('admin','lead') and p_to = d.prev_stage then ok := true;
    else raise exception 'Only Sam or TJ can reopen a lost deal, back to the stage it was in.'; end if;
  elsif p_to = 'lost' then
    if r <> 'lead' then raise exception 'Only Sam can mark a deal lost.'; end if;
    if coalesce(trim(p_reason), '') = '' then raise exception 'Pick a reason for marking this deal lost.'; end if;
    ok := true;
  elsif d.stage = any(early) and p_to = any(early) then
    ok := true;
  elsif d.stage = 'ready' and p_to = 'submitted' then
    if r <> 'admin' then raise exception 'Only TJ submits deals to lenders.'; end if;
    ok := true;
  elsif r in ('admin','lead') and (
       (d.stage = 'submitted' and p_to in ('approved','declined'))
    or (d.stage = 'approved'  and p_to in ('car','declined'))
    or (d.stage = 'car'       and p_to = 'closed')) then
    ok := true;
  end if;

  if not ok then
    if r = 'agent' and p_to = any(later) then
      raise exception 'Only TJ or Sam can move deals past Ready to submit.';
    end if;
    if d.stage = any(later) and p_to = any(early) then
      raise exception 'A deal can''t go back once it''s with lenders.';
    end if;
    raise exception 'Can''t move from % straight to %.', public.stage_name(d.stage), public.stage_name(p_to);
  end if;

  perform set_config('app.via_rpc', 'on', true);
  if p_to = 'lost' then
    update public.deals set stage = 'lost', prev_stage = d.stage, lost_reason = trim(p_reason), stage_changed_at = now() where id = p_deal;
    txt := nm || ' marked this Lost · ' || trim(p_reason);
  elsif d.stage = 'lost' then
    update public.deals set stage = p_to, prev_stage = null, lost_reason = null, stage_changed_at = now() where id = p_deal;
    txt := nm || ' reopened this deal into ' || public.stage_name(p_to);
  else
    update public.deals set stage = p_to, stage_changed_at = now() where id = p_deal;
    txt := nm || ' moved this to ' || public.stage_name(p_to);
  end if;
  perform set_config('app.via_rpc', 'off', true);

  perform public.log_event(p_deal, txt, d.agent_id);

  -- A deal reaching Ready to submit also tells TJ.
  if p_to = 'ready' then
    for a in select id from public.profiles where role = 'admin' loop
      if a.id <> d.agent_id and a.id <> auth.uid() then
        insert into public.notifications (user_id, deal_id, actor_id, kind, body)
        values (a.id, p_deal, auth.uid(), 'update', txt);
      end if;
    end loop;
  end if;
end $$;

create or replace function public.reassign_deal(p_deal bigint, p_agent uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  d public.deals;
  r public.app_role := public.my_role();
  from_name text; to_name text; txt text;
begin
  if r is null or r not in ('admin','lead') then raise exception 'Only Sam or TJ can reassign deals.'; end if;
  select * into d from public.deals where id = p_deal for update;
  if not found then raise exception 'Deal not found.'; end if;
  if d.stage in ('closed','declined') then raise exception '% deals are final.', public.stage_name(d.stage); end if;
  if d.agent_id = p_agent then return; end if;
  select name into to_name from public.profiles where id = p_agent;
  if to_name is null then raise exception 'That person isn''t on the team.'; end if;
  select name into from_name from public.profiles where id = d.agent_id;

  perform set_config('app.via_rpc', 'on', true);
  update public.deals set agent_id = p_agent where id = p_deal;
  perform set_config('app.via_rpc', 'off', true);

  txt := public.actor_name() || ' reassigned this from ' || from_name || ' to ' || to_name;
  perform public.log_event(p_deal, txt, p_agent);
end $$;

-- TJ submits a deal to one or more lenders. From Ready to submit this also moves the deal.
create or replace function public.add_lenders(p_deal bigint, p_lenders text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  d public.deals;
  added text[] := '{}';
  l text;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'Only TJ submits deals to lenders.'; end if;
  select * into d from public.deals where id = p_deal;
  if not found then raise exception 'Deal not found.'; end if;
  if d.stage not in ('ready','submitted','approved') then
    raise exception 'Lenders can be added from Ready to submit until the car is chosen.';
  end if;
  if coalesce(array_length(p_lenders, 1), 0) = 0 then raise exception 'Pick at least one lender.'; end if;
  if d.stage = 'ready' then perform public.move_deal(p_deal, 'submitted'); end if;
  foreach l in array p_lenders loop
    insert into public.lender_submissions (deal_id, lender) values (p_deal, trim(l))
    on conflict (deal_id, lender) do nothing;
    if found then added := added || trim(l); end if;
  end loop;
  if array_length(added, 1) > 0 then
    perform public.log_event(p_deal, public.actor_name() || ' submitted to ' || array_to_string(added, ', '), d.agent_id);
  end if;
end $$;

create or replace function public.set_lender_status(p_submission bigint, p_status text, p_terms text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.lender_submissions;
  d public.deals;
begin
  if public.my_role() is null or public.my_role() not in ('admin','lead') then
    raise exception 'Only TJ or Sam can update lender decisions.';
  end if;
  if p_status not in ('pending','approved','declined') then raise exception 'Unknown status.'; end if;
  select * into s from public.lender_submissions where id = p_submission for update;
  if not found then raise exception 'Lender not found.'; end if;
  select * into d from public.deals where id = s.deal_id;
  if d.stage in ('closed','declined','lost') then raise exception 'This deal is no longer open.'; end if;

  update public.lender_submissions
     set status = p_status, terms = coalesce(p_terms, terms), updated_at = now()
   where id = p_submission;

  if p_status is distinct from s.status then
    perform public.log_event(s.deal_id,
      public.actor_name() || ' marked ' || s.lender || ' as ' || initcap(p_status), d.agent_id);
    -- First approval moves the deal to Conditionally approved.
    if p_status = 'approved' and d.stage = 'submitted' then
      perform public.move_deal(s.deal_id, 'approved');
    end if;
  end if;
end $$;

create or replace function public.log_licence_view(p_deal bigint, p_side text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_see_deal(p_deal) then raise exception 'Deal not found.'; end if;
  insert into public.licence_access_log (deal_id, user_id, side) values (p_deal, auth.uid(), p_side);
end $$;

-- ───────────────────────── Triggers ─────────────────────────

-- Stage, owner and history fields only change through the functions above.
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
      if new.vehicle_desc is distinct from old.vehicle_desc
         or new.vehicle_price is distinct from old.vehicle_price
         or new.dealer is distinct from old.dealer then
        raise exception 'Only TJ or Sam can edit the vehicle.';
      end if;
      if old.stage in ('closed','declined') then raise exception 'This deal is final.'; end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger deals_guard before update on public.deals
for each row execute function public.deals_guard();

create or replace function public.deals_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  agent_name text;
  txt text;
begin
  select name into agent_name from public.profiles where id = new.agent_id;
  txt := public.actor_name() || ' created this deal'
         || case when new.agent_id is distinct from auth.uid() then ' for ' || agent_name else '' end;
  perform public.log_event(new.id, txt, new.agent_id);
  return new;
end $$;
create trigger deals_after_insert after insert on public.deals
for each row execute function public.deals_after_insert();

-- @mentions in chat notify the tagged person, if they can see the deal.
create or replace function public.messages_mentions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p record;
  d public.deals;
begin
  if new.kind <> 'user' then return new; end if;
  select * into d from public.deals where id = new.deal_id;
  for p in
    select id, name, role from public.profiles
    where id is distinct from new.author_id
      and new.body ~* ('(^|[^[:alnum:]_])@'
          || regexp_replace(name, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g')
          || '([^[:alnum:]_]|$)')
  loop
    if p.role in ('admin','lead') or d.agent_id = p.id then
      insert into public.notifications (user_id, deal_id, actor_id, kind, body)
      values (p.id, new.deal_id, new.author_id, 'mention', new.body);
    end if;
  end loop;
  return new;
end $$;
create trigger messages_mentions after insert on public.messages
for each row execute function public.messages_mentions();

-- New logins get a profile. TJ sets names and roles (see supabase/setup_team.sql).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, role)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)),
          'agent')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ───────────────────────── Function access ─────────────────────────

-- Internal helpers can't be called from the app directly.
revoke execute on function public.log_event(bigint, text, uuid) from public, anon, authenticated;
revoke execute on function public.deals_guard() from public, anon, authenticated;
revoke execute on function public.deals_after_insert() from public, anon, authenticated;
revoke execute on function public.messages_mentions() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

revoke execute on function public.move_deal(bigint, text, text) from public, anon;
revoke execute on function public.reassign_deal(bigint, uuid) from public, anon;
revoke execute on function public.add_lenders(bigint, text[]) from public, anon;
revoke execute on function public.set_lender_status(bigint, text, text) from public, anon;
revoke execute on function public.log_licence_view(bigint, text) from public, anon;
grant execute on function public.move_deal(bigint, text, text) to authenticated;
grant execute on function public.reassign_deal(bigint, uuid) to authenticated;
grant execute on function public.add_lenders(bigint, text[]) to authenticated;
grant execute on function public.set_lender_status(bigint, text, text) to authenticated;
grant execute on function public.log_licence_view(bigint, text) to authenticated;

-- ───────────────────────── Row-level security ─────────────────────────

alter table public.profiles enable row level security;
alter table public.lenders enable row level security;
alter table public.lost_reasons enable row level security;
alter table public.deals enable row level security;
alter table public.lender_submissions enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.deal_events enable row level security;
alter table public.licence_access_log enable row level security;
alter table public.feature_ideas enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (true);

create policy lenders_read on public.lenders for select to authenticated using (public.my_role() is not null);
create policy lenders_admin on public.lenders for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create policy lost_reasons_read on public.lost_reasons for select to authenticated using (public.my_role() is not null);
create policy lost_reasons_admin on public.lost_reasons for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create policy deals_read on public.deals for select to authenticated
  using (public.my_role() in ('admin','lead') or (public.my_role() = 'agent' and agent_id = auth.uid()));
create policy deals_create on public.deals for insert to authenticated
  with check (
    public.my_role() is not null
    and created_by = auth.uid()
    and stage = 'new'
    and (public.my_role() in ('admin','lead') or agent_id = auth.uid())
  );
create policy deals_edit on public.deals for update to authenticated
  using (public.my_role() in ('admin','lead') or (public.my_role() = 'agent' and agent_id = auth.uid()))
  with check (public.my_role() in ('admin','lead') or (public.my_role() = 'agent' and agent_id = auth.uid()));
-- No delete policy: deals are never deleted from the app.

create policy lender_submissions_read on public.lender_submissions for select to authenticated
  using (public.can_see_deal(deal_id));

create policy messages_read on public.messages for select to authenticated
  using (public.can_see_deal(deal_id));
create policy messages_send on public.messages for insert to authenticated
  with check (kind = 'user' and author_id = auth.uid() and public.can_see_deal(deal_id));

create policy notifications_read on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy deal_events_read on public.deal_events for select to authenticated
  using (public.can_see_deal(deal_id));

create policy licence_log_admin_read on public.licence_access_log for select to authenticated
  using (public.my_role() = 'admin');

create policy ideas_read on public.feature_ideas for select to authenticated using (public.my_role() is not null);
create policy ideas_create on public.feature_ideas for insert to authenticated
  with check (public.my_role() is not null and created_by = auth.uid());

-- ───────────────────────── Licence storage ─────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('licences', 'licences', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do nothing;

create policy licences_read on storage.objects for select to authenticated
  using (bucket_id = 'licences' and public.can_see_licence_path(name));
create policy licences_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'licences' and public.can_see_licence_path(name));
-- No update or delete policies: licence files are kept.

-- ───────────────────────── Live updates ─────────────────────────

alter publication supabase_realtime add table
  public.deals, public.lender_submissions, public.messages, public.notifications, public.deal_events;

-- ───────────────────────── Starting settings ─────────────────────────

insert into public.lenders (name) values
  ('TD Auto Finance'), ('Scotiabank'), ('RBC'), ('iA Auto Finance'), ('Rifco'), ('Eden Park');
insert into public.lost_reasons (name) values
  ('No licence sent'), ('Ghosted after sending licence'), ('Bought elsewhere'), ('Not ready to buy');
