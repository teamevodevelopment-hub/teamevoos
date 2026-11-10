"use client";

import { useEffect, useState } from "react";
import { usePortal } from "@/components/PortalProvider";
import { Avatar, Chip } from "@/components/ui";
import { supabase, errText } from "@/lib/supabase/client";
import { ROLE_TITLE, STAGES, when } from "@/lib/stages";
import type { Idea, NamedRow } from "@/lib/types";
import { disablePush, enablePush, isIOS, pushState, type PushState } from "@/lib/push";

interface AccessRow {
  id: number;
  deal_id: number | null;
  user_id: string;
  side: string;
  created_at: string;
}

export default function SettingsPage() {
  const { me, signOut } = usePortal();
  return (
    <div className="settings">
      <section className="scard">
        <h3>Your account</h3>
        <div className="who" style={{ gap: 12 }}>
          <Avatar p={me} size="lg" />
          <div>
            <b>{me.name}</b>
            <div style={{ color: "var(--fg-3)", fontSize: 13 }}>{ROLE_TITLE[me.role]}</div>
          </div>
        </div>
        <p>
          To install the app on your iPhone, open this site in <b>Safari</b>, tap <b>Share</b>, then <b>Add to Home Screen</b>. Open it from the home-screen icon from then on.
        </p>
        <button className="btn" onClick={signOut} style={{ alignSelf: "flex-start" }}>
          Sign out
        </button>
      </section>
      <NotificationSettings />
      {me.role === "admin" && <AdminSettings />}
    </div>
  );
}

function NotificationSettings() {
  const { toast, muteTeam, setMuteTeam } = usePortal();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pushState().then(setState);
  }, []);

  const status: Record<PushState, string> = {
    on: "On for this phone. Messages, mentions and deal updates show on your lock screen.",
    off: "Off for this phone.",
    denied: isIOS() ? "Blocked. Turn them on in your iPhone’s Settings → Notifications → Deals." : "Blocked. Allow notifications for this site in your browser settings.",
    "needs-install": "Install the app first: in Safari tap Share → Add to Home Screen, then open it from the home screen.",
    unsupported: "This browser can’t show notifications.",
  };

  return (
    <section className="scard">
      <h3>Notifications</h3>
      <p>{state ? status[state] : "Checking…"}</p>
      <div className="addrow" style={{ flexWrap: "wrap" }}>
        {state === "off" && (
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setState(await enablePush());
              } catch {
                toast("Couldn’t turn on notifications. Try again.", "warn");
              } finally {
                setBusy(false);
              }
            }}
          >
            Turn on
          </button>
        )}
        {state === "on" && (
          <>
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const { error } = await supabase().rpc("send_test_push");
                setBusy(false);
                if (error) toast(errText(error), "warn");
                else toast("Test sent. Lock your phone to see it.", "ok");
              }}
            >
              Send me a test
            </button>
            <button
              className="btn"
              onClick={async () => {
                await disablePush();
                setState(await pushState());
              }}
            >
              Turn off on this phone
            </button>
          </>
        )}
      </div>
      <label className="opt">
        <input type="checkbox" checked={muteTeam} onChange={(e) => setMuteTeam(e.target.checked)} />
        <span>
          Mute the team room
          <small style={{ display: "block", color: "var(--fg-3)" }}>You’ll still hear about @mentions of you or @team.</small>
        </span>
      </label>
    </section>
  );
}

function AdminSettings() {
  const { lenders, lostReasons, profiles, person, refreshSettings, toast } = usePortal();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [access, setAccess] = useState<AccessRow[]>([]);

  useEffect(() => {
    const sb = supabase();
    sb.from("feature_ideas").select("*").order("created_at", { ascending: false }).then(({ data }) => setIdeas((data ?? []) as Idea[]));
    sb.from("licence_access_log").select("*").order("created_at", { ascending: false }).limit(25).then(({ data }) => setAccess((data ?? []) as AccessRow[]));
  }, []);

  async function add(table: "lenders" | "lost_reasons", name: string) {
    const { error } = await supabase().from(table).insert({ name });
    if (error) return toast(error.code === "23505" ? `“${name}” is already on the list` : errText(error), "warn");
    toast(`Added “${name}”`, "ok");
    refreshSettings();
  }
  async function toggle(table: "lenders" | "lost_reasons", row: NamedRow) {
    const { error } = await supabase().from(table).update({ active: !row.active }).eq("id", row.id);
    if (error) return toast(errText(error), "warn");
    refreshSettings();
  }

  return (
    <>
      <ListCard title="Lenders" text="Shown when you submit a deal. Hidden lenders stay on old deals." rows={lenders} table="lenders" onAdd={add} onToggle={toggle} placeholder="Add a lender" />
      <ListCard title="Lost reasons" text="Sam picks one when marking a deal lost. They feed the reports." rows={lostReasons} table="lost_reasons" onAdd={add} onToggle={toggle} placeholder="Add a reason" />
      <section className="scard">
        <h3>Team</h3>
        <p>Add people in Supabase under Authentication, then set their name and role with setup_team.sql.</p>
        <div className="slist">
          {profiles.map((p) => (
            <div key={p.id}>
              <Avatar p={p} size="sm" />
              {p.name}
              <span className="votes">{ROLE_TITLE[p.role]}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="scard">
        <h3>Feature ideas</h3>
        <p>From the team’s Suggest a feature button.</p>
        <div className="slist">
          {ideas.map((x) => (
            <div key={x.id}>
              <Avatar p={person(x.created_by)} size="sm" />
              <span>{x.body}</span>
              <span className="votes">{when(x.created_at)}</span>
            </div>
          ))}
          {!ideas.length && <div style={{ color: "var(--fg-3)" }}>No ideas yet</div>}
        </div>
      </section>
      <section className="scard">
        <h3>Licence views</h3>
        <p>The last 25 times anyone opened a licence.</p>
        <div className="slist">
          {access.map((a) => (
            <div key={a.id}>
              <Avatar p={person(a.user_id)} size="sm" />
              <span>
                {person(a.user_id)?.name} viewed the {a.side} on deal #{a.deal_id ?? "?"}
              </span>
              <span className="votes">{when(a.created_at)}</span>
            </div>
          ))}
          {!access.length && <div style={{ color: "var(--fg-3)" }}>No views yet</div>}
        </div>
      </section>
      <section className="scard">
        <h3>Stages</h3>
        <p>The pipeline, in order.</p>
        <div className="slist">
          {STAGES.map((s) => (
            <div key={s.id}>
              <Chip stage={s.id} />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function ListCard(props: {
  title: string;
  text: string;
  rows: NamedRow[];
  table: "lenders" | "lost_reasons";
  placeholder: string;
  onAdd: (t: "lenders" | "lost_reasons", name: string) => Promise<void>;
  onToggle: (t: "lenders" | "lost_reasons", row: NamedRow) => Promise<void>;
}) {
  const [v, setV] = useState("");
  return (
    <section className="scard">
      <h3>{props.title}</h3>
      <p>{props.text}</p>
      <div className="slist">
        {props.rows.map((r) => (
          <div key={r.id} style={{ opacity: r.active ? 1 : 0.55 }}>
            {r.name}
            <button className="btn" style={{ marginLeft: "auto", padding: "2px 8px", fontSize: 12 }} onClick={() => props.onToggle(props.table, r)}>
              {r.active ? "Hide" : "Show"}
            </button>
          </div>
        ))}
      </div>
      <form
        className="addrow"
        onSubmit={async (e) => {
          e.preventDefault();
          const name = v.trim();
          if (!name) return;
          await props.onAdd(props.table, name);
          setV("");
        }}
      >
        <input className="input" id={`add-${props.table}`} value={v} onChange={(e) => setV(e.target.value)} placeholder={props.placeholder} aria-label={props.placeholder} />
        <button className="btn">Add</button>
      </form>
    </section>
  );
}
