-- Team chat: one room for the whole team, with reactions, replies, @mentions and
-- automatic celebration posts when a deal is approved or closed.

create table public.team_messages (
  id bigint generated always as identity primary key,
  author_id uuid references public.profiles (id) default auth.uid(),
  kind text not null default 'user' check (kind in ('user','celebration')),
  body text not null check (length(body) between 1 and 4000),
  deal_id bigint references public.deals (id) on delete set null,
  reply_to bigint references public.team_messages (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index team_messages_created_idx on public.team_messages (created_at desc);

create table public.team_reactions (
  message_id bigint not null references public.team_messages (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  emoji text not null check (length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

alter table public.team_messages enable row level security;
alter table public.team_reactions enable row level security;

-- Everyone on the team reads the room. People post only as themselves, and only plain messages:
-- celebration posts come from the database. A celebration names the agent, never the customer;
-- the deal card inside it only shows details to people allowed to see that deal.
create policy team_messages_read on public.team_messages for select to authenticated
  using (public.my_role() is not null);
create policy team_messages_post on public.team_messages for insert to authenticated
  with check (public.my_role() is not null and author_id = auth.uid() and kind = 'user' and deal_id is null and deleted_at is null);

create policy team_reactions_read on public.team_reactions for select to authenticated
  using (public.my_role() is not null);
create policy team_reactions_add on public.team_reactions for insert to authenticated
  with check (public.my_role() is not null and user_id = auth.uid());
create policy team_reactions_remove on public.team_reactions for delete to authenticated
  using (user_id = auth.uid());

-- Delete your own message (TJ can delete any). The text is wiped, the gap stays.
create or replace function public.delete_team_message(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare m public.team_messages;
begin
  select * into m from public.team_messages where id = p_id for update;
  if not found then raise exception 'Message not found.'; end if;
  if m.kind <> 'user' then raise exception 'Celebrations can''t be deleted.'; end if;
  if m.author_id is distinct from auth.uid() and public.my_role() is distinct from 'admin' then
    raise exception 'You can only delete your own messages.';
  end if;
  update public.team_messages set body = '·', deleted_at = now() where id = p_id;
  delete from public.team_reactions where message_id = p_id;
end $$;
revoke execute on function public.delete_team_message(bigint) from public, anon;
grant execute on function public.delete_team_message(bigint) to authenticated;

-- @Name notifies that person; @team or @everyone notifies the whole team.
create or replace function public.team_messages_mentions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p record;
  everyone boolean;
begin
  if new.kind <> 'user' then return new; end if;
  everyone := new.body ~* '(^|[^[:alnum:]_])@(team|everyone)([^[:alnum:]_]|$)';
  for p in
    select id, name from public.profiles
    where id is distinct from new.author_id
      and (everyone or new.body ~* ('(^|[^[:alnum:]_])@'
          || regexp_replace(name, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g')
          || '([^[:alnum:]_]|$)'))
  loop
    insert into public.notifications (user_id, deal_id, actor_id, kind, body)
    values (p.id, null, new.author_id, 'mention', new.body);
  end loop;
  return new;
end $$;
create trigger team_messages_mentions after insert on public.team_messages
for each row execute function public.team_messages_mentions();

-- Approvals and closings post to the room automatically.
create or replace function public.deals_celebrate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stage is distinct from old.stage and new.stage in ('approved','closed') then
    insert into public.team_messages (author_id, kind, body, deal_id)
    values (new.agent_id, 'celebration', new.stage, new.id);
  end if;
  return new;
end $$;
create trigger deals_celebrate after update of stage on public.deals
for each row execute function public.deals_celebrate();

revoke execute on function public.team_messages_mentions() from public, anon, authenticated;
revoke execute on function public.deals_celebrate() from public, anon, authenticated;

alter publication supabase_realtime add table public.team_messages, public.team_reactions;
