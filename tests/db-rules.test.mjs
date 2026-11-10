// Runs the Deal Portal migration in an in-memory Postgres with Supabase stand-ins,
// then checks every permission rule from the spec.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261110000000_init.sql", import.meta.url), "utf8");
const laterMigrations = ["20261110000001_remove_2fa.sql", "20261110000002_team_chat.sql", "20261110000003_auto_finance.sql"].map((f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8"));
const db = new PGlite();

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id bigserial primary key, bucket_id text, name text);
  alter table storage.objects enable row level security;
  create publication supabase_realtime;
`);
await db.exec(migration);
for (const m of laterMigrations) await db.exec(m);
await db.exec(`
  grant usage on schema public, auth, storage to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  revoke update on public.notifications from authenticated;
  grant update (read_at) on public.notifications to authenticated;
  grant usage, select on all sequences in schema public, storage to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
  grant execute on function auth.uid(), auth.jwt() to authenticated;
`);

const U = {
  TJ: "00000000-0000-0000-0000-000000000001",
  Sam: "00000000-0000-0000-0000-000000000002",
  Corbin: "00000000-0000-0000-0000-000000000003",
  Ahmed: "00000000-0000-0000-0000-000000000004",
};
for (const [n, id] of Object.entries(U))
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${n.toLowerCase()}@x.com`, { name: n }]);
await db.exec(`update public.profiles set role='admin' where name='TJ'; update public.profiles set role='lead' where name='Sam';`);

let pass = 0, fail = 0;
async function as(who, sql, params = [], aal = "aal2") {
  await db.exec("reset role");
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [
    U[who],
    JSON.stringify({ sub: U[who], aal }),
  ]);
  await db.exec("set role authenticated");
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}
async function ok(name, fn) {
  try {
    await fn();
    pass++;
    console.log("  ✓", name);
  } catch (e) {
    fail++;
    console.log("  ✗", name, "→", e.message);
  }
}
async function denied(name, fn, expect) {
  try {
    await fn();
    fail++;
    console.log("  ✗", name, "→ was allowed");
  } catch (e) {
    if (expect && !e.message.includes(expect)) {
      fail++;
      console.log("  ✗", name, "→ wrong message:", e.message);
    } else {
      pass++;
      console.log("  ✓", name, "·", e.message);
    }
  }
}
const eq = (a, b, what) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const stage = async (id) => (await db.query("select stage from public.deals where id=$1", [id])).rows[0].stage;
const newDeal = async (who, agent = who) =>
  (await as(who, `insert into public.deals (first_name,last_name,agent_id) values ('Test','Customer',$1) returning id`, [U[agent]])).rows[0].id;

console.log("\nCreating deals");
let c1, a1;
await ok("Corbin creates his own deal", async () => (c1 = await newDeal("Corbin")));
await ok("Ahmed creates his own deal", async () => (a1 = await newDeal("Ahmed")));
await denied("Corbin can't create a deal for Ahmed", () => newDeal("Corbin", "Ahmed"));
await ok("Sam creates a deal for Corbin", async () => newDeal("Sam", "Corbin"));
await denied("Can't create a deal straight into Submitted", () =>
  as("Corbin", `insert into public.deals (first_name,last_name,agent_id,stage) values ('A','B',$1,'submitted')`, [U.Corbin]));

console.log("\nWho sees what");
await ok("Corbin sees only his deals", async () => {
  const r = await as("Corbin", "select agent_id from public.deals");
  if (!r.rows.length || r.rows.some((x) => x.agent_id !== U.Corbin)) throw new Error("saw other deals");
});
await ok("Sam sees every deal", async () => eq((await as("Sam", "select count(*)::int n from public.deals")).rows[0].n, 3, "count"));
await ok("Signing in without two-step verification works", async () =>
  eq((await as("TJ", "select count(*)::int n from public.deals", [], "aal1")).rows[0].n, 3, "count"));
await ok("A login with no team profile sees nothing", async () => {
  U.Stranger = "00000000-0000-0000-0000-000000000009";
  await db.query(`insert into auth.users (id, email) values ($1, 'stranger@x.com')`, [U.Stranger]);
  await db.query(`delete from public.profiles where id = $1`, [U.Stranger]);
  eq((await as("Stranger", "select count(*)::int n from public.deals", [], "aal1")).rows[0].n, 0, "count");
});
await ok("Corbin can't read Ahmed's chat", async () =>
  eq((await as("Corbin", "select count(*)::int n from public.messages where deal_id=$1", [a1])).rows[0].n, 0, "count"));

console.log("\nStage rules");
await ok("Corbin moves New lead → Docs collected → Ready to submit", async () => {
  await as("Corbin", "select public.move_deal($1,'docs')", [c1]);
  await as("Corbin", "select public.move_deal($1,'ready')", [c1]);
  eq(await stage(c1), "ready", "stage");
});
await denied("Corbin can't submit to lenders", () => as("Corbin", "select public.move_deal($1,'submitted')", [c1]), "Only TJ submits");
await denied("Sam can't submit to lenders", () => as("Sam", "select public.move_deal($1,'submitted')", [c1]), "Only TJ submits");
await denied("Sam can't add lenders", () => as("Sam", "select public.add_lenders($1, array['RBC'])", [c1]), "Only TJ submits");
await denied("Corbin can't change the stage by editing the row", () =>
  as("Corbin", "update public.deals set stage='closed' where id=$1", [c1]), "Use the stage buttons");
await denied("Corbin can't move Ahmed's deal", () => as("Corbin", "select public.move_deal($1,'docs')", [a1]), "Deal not found");
await ok("TJ submits to two lenders (deal moves to Submitted)", async () => {
  await as("TJ", "select public.add_lenders($1, array['RBC','Scotiabank'])", [c1]);
  eq(await stage(c1), "submitted", "stage");
});
await denied("Corbin can't move a deal past Submitted", () => as("Corbin", "select public.move_deal($1,'approved')", [c1]), "Only TJ or Sam");
await denied("Corbin can't set a lender decision", async () => {
  const id = (await db.query("select id from public.lender_submissions where deal_id=$1 limit 1", [c1])).rows[0].id;
  await as("Corbin", "select public.set_lender_status($1,'approved')", [id]);
}, "Only TJ or Sam");
await ok("Sam marks a lender approved → deal moves to Conditionally approved", async () => {
  const id = (await db.query("select id from public.lender_submissions where deal_id=$1 and lender='RBC'", [c1])).rows[0].id;
  await as("Sam", "select public.set_lender_status($1,'approved','$25,000 · 8.99% · 84 months')", [id]);
  eq(await stage(c1), "approved", "stage");
});
await denied("A deal can't go back once it's with lenders", () => as("Sam", "select public.move_deal($1,'ready')", [c1]), "can't go back");
await ok("Sam moves to Car selection and Closed", async () => {
  await as("Sam", "select public.move_deal($1,'car')", [c1]);
  await as("Sam", "select public.move_deal($1,'closed')", [c1]);
  eq(await stage(c1), "closed", "stage");
});
await denied("Closed is final", () => as("TJ", "select public.move_deal($1,'car')", [c1]), "final");

console.log("\nLost and reopen");
await denied("Agents can't mark lost", () => as("Ahmed", "select public.move_deal($1,'lost','No licence sent')", [a1]), "Only Sam");
await denied("TJ can't mark lost (Sam only)", () => as("TJ", "select public.move_deal($1,'lost','No licence sent')", [a1]), "Only Sam");
await denied("Sam needs a reason", () => as("Sam", "select public.move_deal($1,'lost','')", [a1]), "reason");
await ok("Sam marks lost with a reason", async () => {
  await as("Sam", "select public.move_deal($1,'lost','No licence sent')", [a1]);
  eq(await stage(a1), "lost", "stage");
});
await denied("Ahmed can't reopen", () => as("Ahmed", "select public.move_deal($1,'new')", [a1]), "reopen");
await ok("TJ reopens it back to New lead", async () => {
  await as("TJ", "select public.move_deal($1,'new')", [a1]);
  eq(await stage(a1), "new", "stage");
});

console.log("\nReassigning");
await denied("Corbin can't reassign", () => as("Corbin", "select public.reassign_deal($1,$2)", [a1, U.Corbin]), "Only Sam or TJ");
await ok("Sam reassigns Ahmed's deal to Corbin; Corbin now sees it", async () => {
  await as("Sam", "select public.reassign_deal($1,$2)", [a1, U.Corbin]);
  eq((await as("Corbin", "select count(*)::int n from public.deals where id=$1", [a1])).rows[0].n, 1, "visible");
});

console.log("\nChat and @mentions");
await ok("@TJ in Corbin's chat notifies TJ", async () => {
  await as("Corbin", "insert into public.messages (deal_id, body) values ($1, 'hey @TJ can you check this')", [a1]);
  eq((await db.query("select count(*)::int n from public.notifications where user_id=$1 and kind='mention'", [U.TJ])).rows[0].n, 1, "count");
});
await ok("@Ahmed on Corbin's deal does not notify Ahmed", async () => {
  await as("Corbin", "insert into public.messages (deal_id, body) values ($1, '@Ahmed fyi')", [a1]);
  eq((await db.query("select count(*)::int n from public.notifications where user_id=$1 and kind='mention'", [U.Ahmed])).rows[0].n, 0, "count");
});
await ok("@TJx doesn't count as a mention of TJ", async () => {
  await as("Corbin", "insert into public.messages (deal_id, body) values ($1, 'email @TJx')", [a1]);
  eq((await db.query("select count(*)::int n from public.notifications where user_id=$1 and kind='mention'", [U.TJ])).rows[0].n, 1, "count");
});
await denied("Can't post a fake system message", () =>
  as("Corbin", "insert into public.messages (deal_id, body, kind) values ($1, 'TJ moved this to Closed', 'system')", [a1]));
await denied("Can't post as someone else", () =>
  as("Corbin", "insert into public.messages (deal_id, body, author_id) values ($1, 'hi', $2)", [a1, U.TJ]));
await denied("Can't write history directly", () => as("Corbin", "select public.log_event($1,'fake')", [a1]));
await ok("Stage moves show in history", async () => {
  const n = (await as("TJ", "select count(*)::int n from public.deal_events where deal_id=$1", [c1])).rows[0].n;
  if (n < 6) throw new Error(`only ${n} events`);
});

console.log("\nNotifications");
await ok("Corbin got notified when Sam moved his deal", async () => {
  const n = (await as("Corbin", "select count(*)::int n from public.notifications where kind='update'")).rows[0].n;
  if (n < 1) throw new Error("none");
});
await ok("People only see their own notifications", async () => {
  const r = await as("Corbin", "select distinct user_id from public.notifications");
  if (r.rows.some((x) => x.user_id !== U.Corbin)) throw new Error("saw others");
});
await denied("Can't rewrite a notification's text", () => as("Corbin", "update public.notifications set body='x'"));
await ok("Can mark own notifications read", () => as("Corbin", "update public.notifications set read_at=now() where read_at is null"));

console.log("\nVehicle and settings");
await denied("Agent can't set the vehicle price", () => as("Corbin", "update public.deals set vehicle_price=25000 where id=$1", [a1]), "Only TJ or Sam");
await denied("Agent can't set the dealer", () => as("Corbin", "update public.deals set dealer='Downtown Toyota' where id=$1", [a1]), "Only TJ or Sam");
await ok("Agent can edit customer details", () => as("Corbin", "update public.deals set phone='416-555-0100' where id=$1", [a1]));
await denied("Agent can't add lenders to the list", () => as("Corbin", "insert into public.lenders (name) values ('X')"));
await ok("TJ can add lenders to the list", () => as("TJ", "insert into public.lenders (name) values ('Desjardins')"));

console.log("\nLicence storage");
await ok("Corbin can upload to his deal's folder", () => as("Corbin", "insert into storage.objects (bucket_id,name) values ('licences', $1)", [`${a1}/front-1.jpg`]));
await denied("Corbin can't upload to a deal he can't see", async () => {
  const other = await newDeal("Ahmed");
  await as("Corbin", "insert into storage.objects (bucket_id,name) values ('licences', $1)", [`${other}/front-1.jpg`]);
});
await ok("Ahmed can't see Corbin's licence files", async () =>
  eq((await as("Ahmed", "select count(*)::int n from storage.objects")).rows[0].n, 0, "count"));
await ok("Licence files can't be deleted (delete removes nothing)", async () => {
  await as("Corbin", "delete from storage.objects");
  eq((await db.query("select count(*)::int n from storage.objects")).rows[0].n, 1, "files left");
});

console.log("\nTeam chat");
const teamMentions = async (who) =>
  (await db.query("select count(*)::int n from public.notifications where user_id=$1 and deal_id is null and kind='mention'", [U[who]])).rows[0].n;
let tm;
await ok("Everyone can post and read the team room", async () => {
  tm = (await as("Ahmed", "insert into public.team_messages (body) values ('morning all ☕') returning id")).rows[0].id;
  eq((await as("Corbin", "select count(*)::int n from public.team_messages where id=$1", [tm])).rows[0].n, 1, "Corbin sees it");
});
await denied("Can't post as someone else", () => as("Corbin", "insert into public.team_messages (body, author_id) values ('hi', $1)", [U.TJ]));
await denied("Can't fake a celebration", () => as("Corbin", "insert into public.team_messages (body, kind) values ('closed', 'celebration')"));
await denied("Can't edit someone's message directly", () => as("Corbin", "update public.team_messages set body='x' where id=$1 returning id", [tm]).then((r) => { if (!r.rows.length) throw new Error("no rows changed"); }));
await ok("@Sam in team chat notifies Sam", async () => {
  const before = await teamMentions("Sam");
  await as("Corbin", "insert into public.team_messages (body) values ('@Sam lunch?')");
  eq(await teamMentions("Sam"), before + 1, "Sam mentions");
});
await ok("@team notifies everyone except the sender", async () => {
  const before = await Promise.all(["TJ", "Sam", "Ahmed", "Corbin"].map(teamMentions));
  await as("Corbin", "insert into public.team_messages (body) values ('big day @team 🔥')");
  const after = await Promise.all(["TJ", "Sam", "Ahmed", "Corbin"].map(teamMentions));
  eq(after.map((n, i) => n - before[i]), [1, 1, 1, 0], "new mentions");
});
await ok("Reactions: add your own, remove your own", async () => {
  await as("Sam", "insert into public.team_reactions (message_id, emoji) values ($1, '🔥')", [tm]);
  await as("Sam", "delete from public.team_reactions where message_id=$1 and emoji='🔥'", [tm]);
});
await denied("Can't react as someone else", () => as("Sam", "insert into public.team_reactions (message_id, emoji, user_id) values ($1, '👍', $2)", [tm, U.TJ]));
await denied("Can't delete someone else's message", () => as("Corbin", "select public.delete_team_message($1)", [tm]), "only delete your own");
await ok("Author deletes own message; text is wiped", async () => {
  await as("Ahmed", "select public.delete_team_message($1)", [tm]);
  const r = (await db.query("select body, deleted_at from public.team_messages where id=$1", [tm])).rows[0];
  if (r.body !== "·" || !r.deleted_at) throw new Error("not wiped");
});
await ok("Closing a deal posts a celebration that names the agent, not the customer", async () => {
  const d = await newDeal("Ahmed");
  await as("Ahmed", "select public.move_deal($1,'docs')", [d]);
  await as("Ahmed", "select public.move_deal($1,'ready')", [d]);
  await as("TJ", "select public.add_lenders($1, array['RBC'])", [d]);
  const sub = (await db.query("select id from public.lender_submissions where deal_id=$1", [d])).rows[0].id;
  await as("TJ", "select public.set_lender_status($1,'approved')", [sub]);
  await as("Sam", "select public.move_deal($1,'car')", [d]);
  await as("Sam", "select public.move_deal($1,'closed')", [d]);
  const rows = (await as("Corbin", "select author_id, body from public.team_messages where kind='celebration' and deal_id=$1 order by id", [d])).rows;
  eq(rows.map((r) => r.body), ["approved", "closed"], "celebrations");
  if (rows.some((r) => r.author_id !== U.Ahmed || /Test|Customer/.test(r.body))) throw new Error("leaked customer or wrong agent");
  eq((await as("Corbin", "select count(*)::int n from public.deals where id=$1", [d])).rows[0].n, 0, "Corbin still can't open the deal");
});

console.log("\nAuto-finance details");
let af, afSub, cond;
await ok("Setup: a deal submitted to a lender", async () => {
  af = await newDeal("Corbin");
  await as("Corbin", "select public.move_deal($1,'docs')", [af]);
  await as("Corbin", "select public.move_deal($1,'ready')", [af]);
  await as("TJ", "select public.add_lenders($1, array['Scotiabank'])", [af]);
  afSub = (await as("TJ", "select id from public.lender_submissions where deal_id=$1", [af])).rows[0].id;
});
await ok("Agent fills in vehicle and trade-in on own deal", () =>
  as("Corbin", "update public.deals set vehicle_year=2022, vehicle_make='Toyota', vehicle_model='RAV4', vehicle_km=45000, vin='2T3W1RFV8NW123456', down_payment=2000, trade_in_desc='2014 Civic', trade_in_value=4500 where id=$1", [af]));
await denied("A VIN must be 17 valid characters", () => as("Corbin", "update public.deals set vin='ABC123' where id=$1", [af]));
await ok("TJ records approval terms", async () => {
  await as("TJ", "select public.set_lender_terms($1, 28500, 8.99, 84, 452.10, 'monthly', 'POI + void cheque')", [afSub]);
  const r = (await as("Corbin", "select amount::float, rate::float, term_months, payment_freq, terms from public.lender_submissions where id=$1", [afSub])).rows[0];
  eq([r.amount, r.rate, r.term_months, r.payment_freq, r.terms], [28500, 8.99, 84, "monthly", "POI + void cheque"], "terms");
});
await denied("Agent can't record approval terms", () => as("Corbin", "select public.set_lender_terms($1, 1, 1, 12, 1, 'monthly', null)", [afSub]), "Only TJ or Sam");
await ok("Agent adds a condition on own deal", async () => {
  cond = (await as("Corbin", "insert into public.deal_conditions (deal_id, label) values ($1, 'Proof of income') returning id", [af])).rows[0].id;
});
await denied("Agent can't add a condition to someone else's deal", () => as("Ahmed", "insert into public.deal_conditions (deal_id, label) values ($1, 'x')", [af]));
await denied("Can't add a condition that's already ticked", () => as("Corbin", "insert into public.deal_conditions (deal_id, label, done_at) values ($1, 'x', now())", [af]));
await denied("Can't tick a condition directly, skipping the record", () =>
  as("Corbin", "update public.deal_conditions set done_at=now() where id=$1 returning id", [cond]).then((r) => { if (!r.rows.length) throw new Error("no rows changed"); }));
await ok("Agent ticks a condition, and it records who", async () => {
  await as("Corbin", "select public.toggle_condition($1, true)", [cond]);
  const r = (await as("Sam", "select done_by from public.deal_conditions where id=$1", [cond])).rows[0];
  eq(r.done_by, U.Corbin, "done_by");
});
await denied("Ahmed can't see or tick Corbin's conditions", () => as("Ahmed", "select public.toggle_condition($1, false)", [cond]), "not found");
await denied("Agent can't remove a ticked condition", () =>
  as("Corbin", "delete from public.deal_conditions where id=$1 returning id", [cond]).then((r) => { if (!r.rows.length) throw new Error("no rows removed"); }));
await ok("Sam can remove any condition", async () => {
  const r = await as("Sam", "delete from public.deal_conditions where id=$1 returning id", [cond]);
  eq(r.rows.length, 1, "removed");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
