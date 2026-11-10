"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePortal } from "@/components/PortalProvider";
import { Avatar, I } from "@/components/ui";
import { Bubble, DealChip, clock, dayLabel, isGrouped, newDay, seenBy } from "@/components/chat/Bubble";
import { Composer } from "@/components/chat/Composer";
import { supabase, errText } from "@/lib/supabase/client";
import { previewText } from "@/lib/chatFiles";
import type { Deal, Profile, TeamMessage, TeamReaction } from "@/lib/types";

export default function TeamPage() {
  const { me, profiles, person, deals, toast, markRead, reads, online } = usePortal();
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [reactions, setReactions] = useState<TeamReaction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [replyTo, setReplyTo] = useState<TeamMessage | null>(null);
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [activeMsg, setActiveMsg] = useState<number | null>(null);
  const [wins, setWins] = useState<Record<string, number>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<ReturnType<ReturnType<typeof supabase>["channel"]> | null>(null);
  const stick = useRef(true);

  const loadReactions = useCallback(async () => {
    const { data } = await supabase().from("team_reactions").select("message_id,user_id,emoji");
    setReactions((data ?? []) as TeamReaction[]);
  }, []);

  const loadWins = useCallback(async () => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const { data } = await supabase()
      .from("team_messages")
      .select("author_id")
      .eq("kind", "celebration")
      .eq("body", "closed")
      .gte("created_at", start.toISOString());
    const w: Record<string, number> = {};
    for (const r of data ?? []) if (r.author_id) w[r.author_id] = (w[r.author_id] ?? 0) + 1;
    setWins(w);
  }, []);

  // Load the room, then keep it live: messages, reactions, who's online, who's typing.
  useEffect(() => {
    const sb = supabase();
    let alive = true;
    (async () => {
      const { data } = await sb.from("team_messages").select("*").order("id", { ascending: false }).limit(300);
      if (!alive) return;
      setMessages(((data ?? []) as TeamMessage[]).reverse());
      setLoaded(true);
    })();
    loadReactions();
    loadWins();

    let rt: ReturnType<typeof setTimeout> | undefined;
    const ch = sb
      .channel("team-room")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "team_messages" }, (x) => {
        const m = x.new as TeamMessage;
        setMessages((list) => (list.some((y) => y.id === m.id) ? list : [...list, m]));
        if (m.author_id) setTyping((t) => ({ ...t, [m.author_id!]: 0 }));
        if (m.kind === "celebration") loadWins();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "team_messages" }, (x) => {
        const m = x.new as TeamMessage;
        setMessages((list) => list.map((y) => (y.id === m.id ? m : y)));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "team_reactions" }, () => {
        clearTimeout(rt);
        rt = setTimeout(loadReactions, 150);
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const id = (payload as { id: string }).id;
        if (id !== me.id) setTyping((t) => ({ ...t, [id]: Date.now() }));
      })
      .subscribe();
    channelRef.current = ch;
    const sweep = setInterval(() => setTyping((t) => ({ ...t })), 1500);
    return () => {
      alive = false;
      clearTimeout(rt);
      clearInterval(sweep);
      sb.removeChannel(ch);
      channelRef.current = null;
    };
  }, [me.id, loadReactions, loadWins]);

  // Stay scrolled to the newest message unless the person has scrolled up to read.
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
    if (messages.length && document.visibilityState === "visible") markRead("team");
  }, [messages, markRead]);
  useEffect(() => {
    const onVis = () => document.visibilityState === "visible" && markRead("team");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [markRead]);

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const myLast = useMemo(() => [...messages].reverse().find((m) => m.author_id === me.id && m.kind === "user" && !m.deleted_at), [messages, me.id]);
  const typingNames = Object.entries(typing)
    .filter(([, at]) => at && Date.now() - at < 4000)
    .map(([id]) => person(id)?.name)
    .filter(Boolean) as string[];

  async function toggleReaction(m: TeamMessage, emoji: string) {
    setPickerFor(null);
    const mine = reactions.some((r) => r.message_id === m.id && r.user_id === me.id && r.emoji === emoji);
    // Show it straight away; the live update confirms it.
    setReactions((rs) =>
      mine
        ? rs.filter((r) => !(r.message_id === m.id && r.user_id === me.id && r.emoji === emoji))
        : [...rs, { message_id: m.id, user_id: me.id, emoji }],
    );
    const q = supabase().from("team_reactions");
    const { error } = mine
      ? await q.delete().eq("message_id", m.id).eq("user_id", me.id).eq("emoji", emoji)
      : await q.insert({ message_id: m.id, emoji });
    if (error) {
      toast(errText(error), "warn");
      loadReactions();
    }
  }

  async function remove(m: TeamMessage) {
    const { error } = await supabase().rpc("delete_team_message", { p_id: m.id });
    if (error) toast(errText(error), "warn");
  }

  const sortedPeople = [...profiles].sort((a, b) => Number(online.includes(b.id)) - Number(online.includes(a.id)) || a.name.localeCompare(b.name));
  const maxWins = Math.max(1, ...Object.values(wins));

  return (
    <div className="team" onClick={() => setPickerFor(null)}>
      <section className="team-main">
        <div className="team-online-row">
          {sortedPeople.map((p) => (
            <span key={p.id} className={`pres${online.includes(p.id) ? " on" : ""}`} title={`${p.name}${online.includes(p.id) ? " · online" : ""}`}>
              <Avatar p={p} size="sm" />
            </span>
          ))}
          <span className="pres-count">{online.length} online</span>
        </div>

        <div
          className="tm-list"
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {!loaded && <div className="skel" style={{ height: 120 }} />}
          {loaded && !messages.length && (
            <div className="emptystate">
              <h3>Say hi to the team 👋</h3>
              Wins, questions, memes. Approvals and closed deals post here automatically, with confetti.
            </div>
          )}
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const grouped = isGrouped(prev, m);
            const seen = m.id === myLast?.id ? seenBy(reads, "team", m, me.id, person) : [];
            return (
              <Fragment key={m.id}>
                {newDay(prev, m) && (
                  <div className="tm-day">
                    <span>{dayLabel(m.created_at)}</span>
                  </div>
                )}
                {m.kind === "celebration" ? (
                  <Celebration m={m} agent={person(m.author_id)} deals={deals} />
                ) : (
                  <Bubble
                    m={m}
                    grouped={!!grouped}
                    mine={m.author_id === me.id}
                    canDelete={m.author_id === me.id || me.role === "admin"}
                    author={person(m.author_id)}
                    parent={m.reply_to ? byId.get(m.reply_to) : undefined}
                    reactions={reactions.filter((r) => r.message_id === m.id)}
                    footer={seen.length > 0 && <div className="seenby">Seen by {seen.join(", ")}</div>}
                    active={activeMsg === m.id}
                    onActivate={() => setActiveMsg((a) => (a === m.id ? null : m.id))}
                    pickerOpen={pickerFor === m.id}
                    onPicker={() => setPickerFor((p) => (p === m.id ? null : m.id))}
                    onReact={(e) => toggleReaction(m, e)}
                    onReply={() => {
                      setReplyTo(m);
                      document.getElementById("team-text")?.focus();
                    }}
                    onDelete={() => remove(m)}
                  />
                )}
              </Fragment>
            );
          })}
        </div>

        <div className="tm-typing" aria-live="polite">
          {typingNames.length > 0 && (
            <>
              <span className="dots">
                <i />
                <i />
                <i />
              </span>
              {typingNames.join(" and ")} {typingNames.length > 1 ? "are" : "is"} typing…
            </>
          )}
        </div>

        <Composer
          id="team-text"
          folder="team"
          placeholder="Message the team… @ to tag, # to drop in a deal"
          mentionables={[
            ...profiles.filter((p) => p.id !== me.id).map((p) => ({ key: p.id, label: p.name, profile: p })),
            { key: "team", label: "team", sub: "Everyone" },
          ]}
          dealTokens
          replyTo={replyTo ? { name: person(replyTo.author_id)?.name ?? "Someone", text: previewText(replyTo) } : null}
          onCancelReply={() => setReplyTo(null)}
          onTyping={() => channelRef.current?.send({ type: "broadcast", event: "typing", payload: { id: me.id } })}
          onSend={async (body, file) => {
            const { error } = await supabase()
              .from("team_messages")
              .insert({ body, reply_to: replyTo?.id ?? null, ...(file ?? {}) });
            if (error) {
              toast(errText(error), "warn");
              return false;
            }
            setReplyTo(null);
            stick.current = true;
            return true;
          }}
        />
      </section>

      <aside className="team-side">
        <div className="scard">
          <h3>Online now</h3>
          <div className="people">
            {sortedPeople.map((p) => (
              <div key={p.id} className={`pres-row${online.includes(p.id) ? " on" : ""}`}>
                <span className="pres">
                  <Avatar p={p} size="sm" />
                </span>
                {p.name}
                <small>{online.includes(p.id) ? "Online" : "Away"}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="scard">
          <h3 className="ic-h">
            {I.trophy}Closed this month
          </h3>
          {Object.keys(wins).length === 0 ? (
            <p>No closed deals yet this month. The first one gets confetti.</p>
          ) : (
            <div className="wins">
              {Object.entries(wins)
                .sort((a, b) => b[1] - a[1])
                .map(([id, n], i) => (
                  <div key={id} className="win">
                    <span className="who">
                      <Avatar p={person(id)} size="sm" />
                      {person(id)?.name}
                      {i === 0 && (
                        <span className="crown" title="Top closer this month">
                          {I.crown}
                        </span>
                      )}
                    </span>
                    <span className="bar">
                      <span style={{ width: `${(n / maxWins) * 100}%` }} />
                    </span>
                    <b className="tnum">{n}</b>
                  </div>
                ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function Celebration({ m, agent, deals }: { m: TeamMessage; agent?: Profile; deals: Deal[] }) {
  const closed = m.body === "closed";
  return (
    <div className={`tm-celebrate${closed ? " closed" : ""}`}>
      <span className="big">{closed ? "🎉" : "✅"}</span>
      <div>
        <b>{closed ? `${agent?.name ?? "Someone"} just closed a deal!` : `${agent?.name ?? "Someone"}’s deal got approved`}</b>
        <div className="sub">
          {m.deal_id && <DealChip id={m.deal_id} deals={deals} />}
          <span>{clock(m.created_at)}</span>
        </div>
      </div>
    </div>
  );
}

