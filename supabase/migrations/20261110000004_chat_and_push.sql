-- Phone app, like WhatsApp: push notifications, private 1-to-1 chats,
-- photos, files and voice notes in every chat, and read receipts.
-- Adds tables and columns; existing messages are kept as they are.

-- ───────────── Helpers ─────────────

-- Whether a given person (not just the caller) can see a deal. Used to work out who to notify.
create or replace function public.user_can_see_deal(p_user uuid, p_deal bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.deals d join public.profiles p on p.id = p_user
    where d.id = p_deal and (p.role in ('admin','lead') or d.agent_id = p_user)
  )
$$;

-- One key per pair of people, the same whichever way round: "<smaller id>_<larger id>".
create or replace function public.dm_key(a uuid, b uuid) returns text
language sql immutable as $$ select least(a, b)::text || '_' || greatest(a, b)::text $$;

-- ───────────── Attachments in deal chats and the team room ─────────────

alter table public.messages drop constraint messages_body_check;
alter table public.messages alter column body set default '';
alter table public.messages
  add column file_path text,
  add column file_kind text check (file_kind in ('image','file','voice')),
  add column file_name text check (length(file_name) <= 200),
  add column file_size int check (file_size between 0 and 26214400),
  add column file_ms int check (file_ms between 0 and 3600000),
  add constraint messages_body_check check (length(body) <= 5000 and (length(body) >= 1 or file_path is not null)),
  add constraint messages_file_check check ((file_path is null) = (file_kind is null));

drop policy messages_send on public.messages;
create policy messages_send on public.messages for insert to authenticated
  with check (kind = 'user' and author_id = auth.uid() and public.can_see_deal(deal_id)
              and (file_path is null or file_path like 'deal/' || deal_id || '/%'));

alter table public.team_messages drop constraint team_messages_body_check;
alter table public.team_messages alter column body set default '';
alter table public.team_messages
  add column file_path text,
  add column file_kind text check (file_kind in ('image','file','voice')),
  add column file_name text check (length(file_name) <= 200),
  add column file_size int check (file_size between 0 and 26214400),
  add column file_ms int check (file_ms between 0 and 3600000),
  add constraint team_messages_body_check check (length(body) <= 4000 and (length(body) >= 1 or file_path is not null)),
  add constraint team_messages_file_check check ((file_path is null) = (file_kind is null));

drop policy team_messages_post on public.team_messages;
create policy team_messages_post on public.team_messages for insert to authenticated
  with check (public.my_role() is not null and author_id = auth.uid() and kind = 'user' and deal_id is null
              and deleted_at is null and (file_path is null or file_path like 'team/%'));

-- Deleting a team message also removes its attachment from the chat.
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
  update public.team_messages
     set body = '·', file_path = null, file_kind = null, file_name = null, file_size = null, file_ms = null, deleted_at = now()
   where id = p_id;
  delete from public.team_reactions where message_id = p_id;
end $$;

-- ───────────── Private 1-to-1 chats ─────────────
-- Only the two people in a chat can read it. Nobody else, TJ included.

create table public.direct_messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null default auth.uid() references public.profiles (id),
  recipient_id uuid not null references public.profiles (id),
  body text not null default '' check (length(body) <= 4000),
  file_path text,
  file_kind text check (file_kind in ('image','file','voice')),
  file_name text check (length(file_name) <= 200),
  file_size int check (file_size between 0 and 26214400),
  file_ms int check (file_ms between 0 and 3600000),
  reply_to bigint references public.direct_messages (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id),
  check (length(body) >= 1 or file_path is not null),
  check ((file_path is null) = (file_kind is null))
);
create index direct_messages_pair_idx on public.direct_messages (public.dm_key(sender_id, recipient_id), id desc);
create index direct_messages_recipient_idx on public.direct_messages (recipient_id, created_at);
alter table public.direct_messages enable row level security;

create policy direct_messages_read on public.direct_messages for select to authenticated
  using (public.my_role() is not null and auth.uid() in (sender_id, recipient_id));
create policy direct_messages_send on public.direct_messages for insert to authenticated
  with check (public.my_role() is not null and sender_id = auth.uid() and deleted_at is null
              and exists (select 1 from public.profiles where id = recipient_id)
              and (file_path is null or file_path like 'dm/' || public.dm_key(sender_id, recipient_id) || '/%'));

create or replace function public.delete_direct_message(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare m public.direct_messages;
begin
  select * into m from public.direct_messages where id = p_id for update;
  if not found or m.sender_id is distinct from auth.uid() then raise exception 'You can only delete your own messages.'; end if;
  update public.direct_messages
     set body = '·', file_path = null, file_kind = null, file_name = null, file_size = null, file_ms = null, deleted_at = now()
   where id = p_id;
end $$;
revoke execute on function public.delete_direct_message(bigint) from public, anon;
grant execute on function public.delete_direct_message(bigint) to authenticated;

-- ───────────── Chat files ─────────────
-- Paths: "team/<file>", "deal/<deal id>/<file>", "dm/<pair key>/<file>".

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-files', 'chat-files', false, 26214400, array[
  'image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
  'application/pdf','text/plain','text/csv',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'audio/mp4','audio/aac','audio/mpeg','audio/webm','audio/ogg','audio/x-m4a',
  'video/mp4','video/quicktime'])
on conflict (id) do nothing;

create or replace function public.can_see_chat_path(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_name ~ '^team/[^/]+$' then public.my_role() is not null
    when p_name ~ '^deal/[0-9]+/[^/]+$' then public.can_see_deal(split_part(p_name, '/', 2)::bigint)
    when p_name ~ '^dm/[0-9a-f-]{36}_[0-9a-f-]{36}/[^/]+$' then
      public.my_role() is not null and auth.uid()::text in (
        split_part(split_part(p_name, '/', 2), '_', 1), split_part(split_part(p_name, '/', 2), '_', 2))
    else false end
$$;
create policy chat_files_read on storage.objects for select to authenticated
  using (bucket_id = 'chat-files' and public.can_see_chat_path(name));
create policy chat_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-files' and public.can_see_chat_path(name));

-- ───────────── Read receipts and unread counts ─────────────
-- One row per person per chat: when they last read it.
-- Chats: "team", "deal:<deal id>", "dm:<the other person's id>".

create table public.chat_reads (
  user_id uuid not null references public.profiles (id) on delete cascade,
  chat text not null check (chat ~ '^(team|deal:[0-9]+|dm:[0-9a-f-]{36})$'),
  last_read_at timestamptz not null default now(),
  primary key (user_id, chat)
);
alter table public.chat_reads enable row level security;

-- You see read times for chats you're in: the team room, deals you can see, and the
-- other person's read time in your own private chats.
create policy chat_reads_read on public.chat_reads for select to authenticated
  using (public.my_role() is not null and (
    user_id = auth.uid()
    or chat = 'team'
    or (case when chat ~ '^deal:[0-9]+$' then public.can_see_deal(substr(chat, 6)::bigint) else false end)
    or chat = 'dm:' || auth.uid()::text));

create or replace function public.mark_read(p_chat text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is null then raise exception 'Not signed in.'; end if;
  if p_chat ~ '^deal:[0-9]+$' then
    if not public.can_see_deal(substr(p_chat, 6)::bigint) then raise exception 'Deal not found.'; end if;
  elsif p_chat ~ '^dm:[0-9a-f-]{36}$' then
    if not exists (select 1 from public.profiles where id::text = substr(p_chat, 4) and id <> auth.uid()) then
      raise exception 'Person not found.';
    end if;
  elsif p_chat <> 'team' then
    raise exception 'Unknown chat.';
  end if;
  insert into public.chat_reads (user_id, chat, last_read_at) values (auth.uid(), p_chat, now())
  on conflict (user_id, chat) do update set last_read_at = greatest(public.chat_reads.last_read_at, excluded.last_read_at);
end $$;
revoke execute on function public.mark_read(text) from public, anon;
grant execute on function public.mark_read(text) to authenticated;

-- Unread messages per chat for one person. A chat they've never opened counts from when they joined.
create or replace function public.unread_counts(p_user uuid)
returns table (chat text, n int) language sql stable security definer set search_path = public as $$
  with me as (select created_at from public.profiles where id = p_user),
       r as (select chat, last_read_at from public.chat_reads where user_id = p_user)
  select 'team'::text, count(*)::int
    from public.team_messages m, me
   where m.author_id is distinct from p_user and m.deleted_at is null
     and m.created_at > coalesce((select last_read_at from r where r.chat = 'team'), me.created_at)
  having count(*) > 0
  union all
  select 'deal:' || m.deal_id, count(*)::int
    from public.messages m, me
   where m.kind = 'user' and m.author_id is distinct from p_user
     and public.user_can_see_deal(p_user, m.deal_id)
     and m.created_at > coalesce((select last_read_at from r where r.chat = 'deal:' || m.deal_id), me.created_at)
   group by m.deal_id
  union all
  select 'dm:' || m.sender_id, count(*)::int
    from public.direct_messages m, me
   where m.recipient_id = p_user and m.deleted_at is null
     and m.created_at > coalesce((select last_read_at from r where r.chat = 'dm:' || m.sender_id), me.created_at)
   group by m.sender_id
$$;
revoke execute on function public.unread_counts(uuid) from public, anon, authenticated;

-- The app's own unread counts.
create or replace function public.my_unread() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.my_role() is null then '{}'::jsonb else jsonb_build_object(
    'chats', coalesce((select jsonb_object_agg(chat, n) from public.unread_counts(auth.uid())), '{}'::jsonb),
    'updates', (select count(*) from public.notifications where user_id = auth.uid() and read_at is null and kind = 'update'))
  end
$$;
revoke execute on function public.my_unread() from public, anon;
grant execute on function public.my_unread() to authenticated;

-- The number on the app icon, like WhatsApp: how many chats have something unread.
-- A deal with unread updates counts once, together with its chat.
create or replace function public.badge_count(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from (
    select chat from public.unread_counts(p_user)
    union
    select 'deal:' || deal_id from public.notifications
     where user_id = p_user and read_at is null and kind = 'update' and deal_id is not null
  ) x
$$;
revoke execute on function public.badge_count(uuid) from public, anon, authenticated;

-- Start everyone at "read" so old history doesn't light up as unread.
insert into public.chat_reads (user_id, chat) select id, 'team' from public.profiles on conflict do nothing;
insert into public.chat_reads (user_id, chat)
  select p.id, 'deal:' || d.id from public.profiles p join public.deals d on public.user_can_see_deal(p.id, d.id)
  on conflict do nothing;

-- ───────────── Notification settings and phones ─────────────

create table public.user_prefs (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  mute_team boolean not null default false,
  -- Which chat the person has open right now, so they aren't pinged about what they're reading.
  active_chat text,
  active_at timestamptz
);
alter table public.user_prefs enable row level security;
create policy user_prefs_own_read on public.user_prefs for select to authenticated using (user_id = auth.uid());
create policy user_prefs_own_add on public.user_prefs for insert to authenticated with check (user_id = auth.uid());
create policy user_prefs_own_edit on public.user_prefs for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.push_subscriptions (
  endpoint text primary key check (endpoint ~ '^https://'),
  user_id uuid not null references public.profiles (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  device text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_own on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_subscriptions_remove on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- A phone that switches accounts moves to the new person.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_device text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is null then raise exception 'Not signed in.'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, device)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_device, 120))
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device;
end $$;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- Where pushes are sent, and the shared secret that proves they came from here.
-- Lives in a schema the app can't reach. Filled in once with a separate one-line script.
create schema if not exists private;
revoke all on schema private from public;
create table private.push_config (
  id int primary key default 1 check (id = 1),
  url text not null,
  secret text not null check (length(secret) >= 32)
);

-- The sender reports phones that have been uninstalled or switched off, so they're dropped.
create or replace function public.push_gone(p_endpoints text[], p_secret text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from private.push_config where id = 1 and secret = p_secret) then
    raise exception 'Not allowed.';
  end if;
  delete from public.push_subscriptions where endpoint = any(p_endpoints);
end $$;
revoke execute on function public.push_gone(text[], text) from public;
grant execute on function public.push_gone(text[], text) to anon, authenticated;

-- ───────────── Sending pushes ─────────────

create extension if not exists pg_net with schema extensions;

-- Drops anyone who has this chat open right now.
create or replace function private.not_watching(p_users uuid[], p_chat text) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(u), '{}') from unnest(p_users) u
  where not exists (select 1 from public.user_prefs p
                    where p.user_id = u and p.active_chat = p_chat and p.active_at > now() - interval '45 seconds')
$$;

-- What a message says on the lock screen.
create or replace function private.preview(p_body text, p_kind text, p_name text, p_ms int) returns text
language sql immutable as $$
  select trim(concat_ws(' ',
    case p_kind
      when 'image' then '📷 Photo'
      when 'voice' then '🎤 Voice note' || coalesce(' (' || (p_ms / 60000) || ':' || lpad(((p_ms / 1000) % 60)::text, 2, '0') || ')', '')
      when 'file' then '📄 ' || coalesce(p_name, 'File')
    end,
    nullif(regexp_replace(coalesce(p_body, ''), '#\[deal:[0-9]+\]', 'a deal', 'g'), '')))
$$;

-- Posts one push per phone to the sender on Vercel. Never blocks the message if anything fails.
create or replace function private.send_push(p_users uuid[], p_chat text, p_title text, p_body text, p_url text, p_tag text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  cfg private.push_config;
  subs jsonb;
begin
  select * into cfg from private.push_config where id = 1;
  if not found then return; end if;
  select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
                                      'badge', public.badge_count(s.user_id)))
    into subs
    from public.push_subscriptions s
   where s.user_id = any(private.not_watching(p_users, p_chat));
  if subs is null then return; end if;
  perform net.http_post(
    url := cfg.url,
    body := jsonb_build_object('subs', subs, 'title', p_title, 'body', left(coalesce(p_body, ''), 180),
                               'url', p_url, 'tag', p_tag),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg.secret));
exception when others then
  raise warning 'Push not sent: %', sqlerrm;
end $$;

create or replace function public.push_deal_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare d public.deals;
begin
  if new.kind <> 'user' then return new; end if;
  select * into d from public.deals where id = new.deal_id;
  perform private.send_push(
    array(select id from public.profiles where id is distinct from new.author_id and public.user_can_see_deal(id, new.deal_id)),
    'deal:' || new.deal_id,
    coalesce((select name from public.profiles where id = new.author_id), 'Someone') || ' · ' || d.first_name || ' ' || d.last_name,
    private.preview(new.body, new.file_kind, new.file_name, new.file_ms),
    '/deals?deal=' || new.deal_id || '&tab=chat',
    'deal-' || new.deal_id);
  return new;
end $$;
create trigger push_deal_message after insert on public.messages
for each row execute function public.push_deal_message();

-- Team room: everyone except people who muted it, who still hear about @mentions of them or @team.
create or replace function public.push_team_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  author text := coalesce((select name from public.profiles where id = new.author_id), 'Someone');
  everyone boolean := new.kind = 'user' and new.body ~* '(^|[^[:alnum:]_])@(team|everyone)([^[:alnum:]_]|$)';
begin
  if new.kind = 'celebration' then
    perform private.send_push(
      array(select p.id from public.profiles p left join public.user_prefs u on u.user_id = p.id
            where p.id is distinct from auth.uid() and not coalesce(u.mute_team, false)),
      'team',
      case when new.body = 'closed' then '🎉 ' || author || ' just closed a deal!' else '✅ ' || author || '’s deal got approved' end,
      'Tap to see it in the team room.', '/team', 'team');
    return new;
  end if;
  perform private.send_push(
    array(select p.id from public.profiles p left join public.user_prefs u on u.user_id = p.id
          where p.id is distinct from new.author_id
            and (not coalesce(u.mute_team, false) or everyone
                 or new.body ~* ('(^|[^[:alnum:]_])@' || regexp_replace(p.name, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '([^[:alnum:]_]|$)'))),
    'team',
    author || ' · Team',
    private.preview(new.body, new.file_kind, new.file_name, new.file_ms),
    '/team', 'team');
  return new;
end $$;
create trigger push_team_message after insert on public.team_messages
for each row execute function public.push_team_message();

create or replace function public.push_direct_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform private.send_push(
    array[new.recipient_id],
    'dm:' || new.sender_id,
    coalesce((select name from public.profiles where id = new.sender_id), 'Someone'),
    private.preview(new.body, new.file_kind, new.file_name, new.file_ms),
    '/chats/' || new.sender_id,
    'dm-' || new.sender_id);
  return new;
end $$;
create trigger push_direct_message after insert on public.direct_messages
for each row execute function public.push_direct_message();

-- Deal updates ("Sam moved Maya Chen to Approved") reach the agent's phone.
create or replace function public.push_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'update' or new.deal_id is null then return new; end if;
  perform private.send_push(
    array[new.user_id],
    'deal:' || new.deal_id,
    coalesce((select first_name || ' ' || last_name from public.deals where id = new.deal_id), 'Deal update'),
    new.body,
    '/deals?deal=' || new.deal_id,
    'deal-' || new.deal_id);
  return new;
end $$;
create trigger push_update after insert on public.notifications
for each row execute function public.push_update();

-- "Send me a test" in Settings.
create or replace function public.send_test_push() returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is null then raise exception 'Not signed in.'; end if;
  if not exists (select 1 from private.push_config) then raise exception 'Notifications aren''t set up on the server yet.'; end if;
  if not exists (select 1 from public.push_subscriptions where user_id = auth.uid()) then
    raise exception 'Turn on notifications on this phone first.';
  end if;
  perform private.send_push(array[auth.uid()], 'test', 'Notifications are on ✅',
    'This is how messages will show up on your phone.', '/settings', 'test');
end $$;
revoke execute on function public.send_test_push() from public, anon;
grant execute on function public.send_test_push() to authenticated;

revoke execute on function public.user_can_see_deal(uuid, bigint) from public, anon, authenticated;
revoke execute on function public.push_deal_message() from public, anon, authenticated;
revoke execute on function public.push_team_message() from public, anon, authenticated;
revoke execute on function public.push_direct_message() from public, anon, authenticated;
revoke execute on function public.push_update() from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

alter publication supabase_realtime add table public.direct_messages, public.chat_reads;
