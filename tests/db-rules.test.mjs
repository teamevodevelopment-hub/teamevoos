// Runs the Deal Portal migration in an in-memory Postgres with Supabase stand-ins,
// then checks every permission rule from the spec.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261110000000_init.sql", import.meta.url), "utf8");
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
await ok("Without two-step verification nobody sees anything", async () =>
  eq((await as("TJ", "select count(*)::int n from public.deals", [], "aal1")).rows[0].n, 0, "count"));
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
await denied("Agent can't edit the vehicle", () => as("Corbin", "update public.deals set vehicle_desc='Civic' where id=$1", [a1]), "Only TJ or Sam");
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
