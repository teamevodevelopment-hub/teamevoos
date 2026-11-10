"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePortal } from "@/components/PortalProvider";
import { Avatar, Chip, I, Mentionized } from "@/components/ui";
import { supabase, errText } from "@/lib/supabase/client";
import { fullName } from "@/lib/stages";
import type { Deal, Profile, TeamMessage, TeamReaction } from "@/lib/types";

const QUICK = ["👍", "🔥", "😂", "🎉", "❤️", "💯", "👀", "🙏"];
const PICKER = [
  "😀", "😂", "🤣", "😅", "😊", "😍", "🤩", "😎", "🤔", "😴", "😤", "🥳",
  "👍", "👎", "👏", "🙌", "🙏", "💪", "🤝", "👀", "🔥", "💯", "🎉", "🚀",
  "❤️", "💸", "💰", "🏆", "⭐", "✅", "❌", "⏰", "☕", "🍕", "🚗", "🔑",
];
const DEAL_TOKEN = /#\[deal:(\d+)\]/g;
const ONLY_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️|\s)+$/u;

function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" });
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });

export default function TeamPage() {
  const { me, profiles, person, deals, toast, markTeamSeen } = usePortal();
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [reactions, setReactions] = useState<TeamReaction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState<string[]>([]);
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
      .channel("team-room", { config: { presence: { key: me.id } } })
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
      .on("presence", { event: "sync" }, () => setOnline(Object.keys(ch.presenceState())))
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const id = (payload as { id: string }).id;
        if (id !== me.id) setTyping((t) => ({ ...t, [id]: Date.now() }));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") ch.track({ at: Date.now() });
      });
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
    const last = messages.at(-1);
    if (last) markTeamSeen(last.id);
  }, [messages, markTeamSeen]);

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
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
            const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
            const grouped =
              !newDay &&
              prev &&
              prev.kind === "user" &&
              m.kind === "user" &&
              prev.author_id === m.author_id &&
              !m.reply_to &&
              new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
            return (
              <Fragment key={m.id}>
                {newDay && (
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
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSent={() => {
            setReplyTo(null);
            stick.current = true;
          }}
          onTyping={() => channelRef.current?.send({ type: "broadcast", event: "typing", payload: { id: me.id } })}
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
          <h3>Closed this month 🏆</h3>
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
                      {i === 0 && " 👑"}
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

function DealChip({ id, deals }: { id: number; deals: Deal[] }) {
  const { openDeal } = usePortal();
  const d = deals.find((x) => x.id === id);
  if (!d) return <span className="dealchip locked">🔒 Private deal</span>;
  return (
    <button
      className="dealchip"
      onClick={(e) => {
        e.stopPropagation();
        openDeal(d.id);
      }}
    >
      {fullName(d)} <Chip stage={d.stage} />
    </button>
  );
}

function Body({ text }: { text: string }) {
  const { profiles, deals } = usePortal();
  const names = [...profiles.map((p) => p.name), "team", "everyone"];
  const parts = text.split(DEAL_TOKEN);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <DealChip key={i} id={Number(part)} deals={deals} />
        ) : (
          <Fragment key={i}>
            {part.split(/(https?:\/\/[^\s]+)/g).map((seg, j) =>
              j % 2 === 1 ? (
                <a key={j} href={seg} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  {seg}
                </a>
              ) : (
                <Mentionized key={j} text={seg} names={names} />
              ),
            )}
          </Fragment>
        ),
      )}
    </>
  );
}

function Bubble(props: {
  m: TeamMessage;
  grouped: boolean;
  mine: boolean;
  canDelete: boolean;
  author?: Profile;
  parent?: TeamMessage;
  reactions: TeamReaction[];
  active: boolean;
  onActivate: () => void;
  pickerOpen: boolean;
  onPicker: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onDelete: () => void;
}) {
  const { m, grouped, author, parent, reactions } = props;
  const { me, person } = usePortal();
  const deleted = !!m.deleted_at;
  const bigEmoji = !deleted && ONLY_EMOJI.test(m.body) && [...m.body.replace(/\s/g, "")].length <= 6;
  const counts = new Map<string, string[]>();
  for (const r of reactions) counts.set(r.emoji, [...(counts.get(r.emoji) ?? []), r.user_id]);

  return (
    <div id={`tm-${m.id}`} className={`tm${grouped ? " grouped" : ""}${props.active ? " active" : ""}`} onClick={props.onActivate}>
      <div className="tm-av">{!grouped && <Avatar p={author} />}</div>
      <div className="tm-b">
        {!grouped && (
          <div className="tm-h">
            <b>{author?.name ?? "Former team member"}</b>
            <small>{clock(m.created_at)}</small>
          </div>
        )}
        {parent && (
          <button
            className="tm-quote"
            onClick={(e) => {
              e.stopPropagation();
              document.getElementById(`tm-${parent.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          >
            {I.reply}
            <b>{person(parent.author_id)?.name}</b>
            <span>{parent.deleted_at ? "Message deleted" : parent.body.replace(DEAL_TOKEN, "a deal")}</span>
          </button>
        )}
        <div className={`tm-x${bigEmoji ? " big" : ""}${deleted ? " deleted" : ""}`}>{deleted ? "Message deleted" : <Body text={m.body} />}</div>
        {counts.size > 0 && (
          <div className="reacts">
            {[...counts.entries()].map(([emoji, users]) => (
              <button
                key={emoji}
                className={`react${users.includes(me.id) ? " mine" : ""}`}
                title={users.map((u) => person(u)?.name).join(", ")}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onReact(emoji);
                }}
              >
                <span>{emoji}</span>
                <b className="tnum">{users.length}</b>
              </button>
            ))}
          </div>
        )}
      </div>
      {!deleted && (
        <div className="tm-actions" onClick={(e) => e.stopPropagation()}>
          {QUICK.slice(0, 4).map((e) => (
            <button key={e} onClick={() => props.onReact(e)} aria-label={`React ${e}`}>
              {e}
            </button>
          ))}
          <button onClick={props.onPicker} aria-label="More reactions">
            {I.smile}
          </button>
          <button onClick={props.onReply} aria-label="Reply">
            {I.reply}
          </button>
          {props.canDelete && (
            <button onClick={props.onDelete} aria-label="Delete message" className="del">
              {I.trash}
            </button>
          )}
          {props.pickerOpen && (
            <div className="emoji-grid" role="listbox">
              {[...QUICK, ...PICKER.filter((x) => !QUICK.includes(x))].map((e) => (
                <button key={e} onClick={() => props.onReact(e)}>
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type Pop = { kind: "mention"; q: string; sel: number } | { kind: "deal"; q: string; sel: number } | null;

function Composer(props: { replyTo: TeamMessage | null; onCancelReply: () => void; onSent: () => void; onTyping: () => void }) {
  const { me, profiles, deals, person, toast } = usePortal();
  const [text, setText] = useState("");
  const [pop, setPop] = useState<Pop>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [picked, setPicked] = useState<{ label: string; id: number }[]>([]);
  const ta = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);

  type Opt = { key: string; label: string; sub?: string; profile?: Profile; deal?: Deal };
  const options: Opt[] = !pop
    ? []
    : pop.kind === "mention"
      ? [
          ...profiles.filter((p) => p.id !== me.id).map((p) => ({ key: p.id, label: p.name, profile: p })),
          { key: "team", label: "team", sub: "Everyone" },
        ].filter((o) => o.label.toLowerCase().startsWith(pop.q.toLowerCase()))
      : deals
          .filter((d) => fullName(d).toLowerCase().includes(pop.q.toLowerCase()))
          .slice(0, 6)
          .map((d) => ({ key: String(d.id), label: fullName(d), deal: d }));

  function resize() {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }

  function onInput(v: string) {
    setText(v);
    requestAnimationFrame(resize);
    const before = v.slice(0, ta.current?.selectionStart ?? v.length);
    const m = before.match(/@(\w*)$/);
    const d = before.match(/#([\w' -]*)$/);
    setPop(m ? { kind: "mention", q: m[1], sel: 0 } : d && d[1].length <= 30 ? { kind: "deal", q: d[1], sel: 0 } : null);
    if (Date.now() - lastTyping.current > 2000) {
      lastTyping.current = Date.now();
      props.onTyping();
    }
  }

  function insertAtCaret(insert: string, pattern?: RegExp) {
    const el = ta.current!;
    const pos = el.selectionStart;
    const head = pattern ? text.slice(0, pos).replace(pattern, insert) : text.slice(0, pos) + insert;
    setText(head + text.slice(pos));
    setPop(null);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = head.length;
      resize();
    });
  }

  function choose(o: Opt) {
    if (pop?.kind === "deal" && o.deal) {
      const label = `#${o.label}`;
      setPicked((p) => [...p.filter((x) => x.label !== label), { label, id: o.deal!.id }]);
      insertAtCaret(`${label} `, /#([\w' -]*)$/);
    } else insertAtCaret(`@${o.label} `, /@(\w*)$/);
  }

  async function send() {
    let body = text.trim();
    if (!body || sending) return;
    // Deal names typed with # become deal cards, so the customer's name isn't stored in the room.
    for (const p of [...picked].sort((a, b) => b.label.length - a.label.length)) body = body.split(p.label).join(`#[deal:${p.id}]`);
    setSending(true);
    const { error } = await supabase().from("team_messages").insert({ body, reply_to: props.replyTo?.id ?? null });
    setSending(false);
    if (error) return toast(errText(error), "warn");
    setText("");
    setPicked([]);
    requestAnimationFrame(resize);
    props.onSent();
  }

  return (
    <form
      className="composer tm-composer"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {props.replyTo && (
        <div className="tm-replying">
          {I.reply}
          <span>
            Replying to <b>{person(props.replyTo.author_id)?.name}</b>: {props.replyTo.body.replace(DEAL_TOKEN, "a deal")}
          </span>
          <button type="button" className="iconbtn" onClick={props.onCancelReply} aria-label="Cancel reply">
            {I.close}
          </button>
        </div>
      )}
      {pop && options.length > 0 && (
        <div className="mpop" role="listbox">
          {options.map((o, i) => (
            <button type="button" key={o.key} className={i === pop.sel ? "sel" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}>
              {o.profile ? <Avatar p={o.profile} size="sm" /> : o.deal ? null : <span className="av sm">@</span>}
              {o.label}
              {o.deal ? <Chip stage={o.deal.stage} /> : <small>{o.sub ?? ""}</small>}
            </button>
          ))}
        </div>
      )}
      {emojiOpen && (
        <div className="emoji-grid composer-grid" role="listbox">
          {PICKER.map((e) => (
            <button
              type="button"
              key={e}
              onClick={() => {
                insertAtCaret(e);
                setEmojiOpen(false);
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
      <div className="box">
        <button type="button" className="iconbtn" aria-label="Emoji" onClick={() => setEmojiOpen((o) => !o)}>
          {I.smile}
        </button>
        <textarea
          ref={ta}
          id="team-text"
          rows={1}
          value={text}
          placeholder="Message the team… @ to tag, # to drop in a deal"
          aria-label="Message the team"
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={(e) => {
            if (pop && options.length) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                return setPop({ ...pop, sel: Math.min(pop.sel + 1, options.length - 1) });
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                return setPop({ ...pop, sel: Math.max(pop.sel - 1, 0) });
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                return choose(options[pop.sel]);
              }
              if (e.key === "Escape") {
                e.stopPropagation();
                return setPop(null);
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn primary" aria-label="Send" style={{ padding: "7px 9px" }} disabled={sending || !text.trim()}>
          {I.send}
        </button>
      </div>
    </form>
  );
}
