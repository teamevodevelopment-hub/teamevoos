"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { usePortal } from "@/components/PortalProvider";
import { Avatar, I } from "@/components/ui";
import { Bubble, Ticks, dayLabel, isGrouped, newDay, type ChatMsg } from "@/components/chat/Bubble";
import { Composer } from "@/components/chat/Composer";
import { supabase, errText } from "@/lib/supabase/client";
import { dmKey, previewText } from "@/lib/chatFiles";
import type { DirectMessage } from "@/lib/types";

const asChat = (m: DirectMessage): ChatMsg & DirectMessage => ({ ...m, author_id: m.sender_id });

/** A private chat between me and one teammate. Nobody else can read it. */
export default function DirectChatPage() {
  const { id: other } = useParams<{ id: string }>();
  const { me, person, toast, markRead, reads, online } = usePortal();
  const them = person(other);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [replyTo, setReplyTo] = useState<DirectMessage | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [typingAt, setTypingAt] = useState(0);
  const [, tick] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const channelRef = useRef<ReturnType<ReturnType<typeof supabase>["channel"]> | null>(null);
  const pair = dmKey(me.id, other);
  const inPair = (m: DirectMessage) => (m.sender_id === me.id && m.recipient_id === other) || (m.sender_id === other && m.recipient_id === me.id);

  // Load the conversation, then stay live: new messages, deletions, typing.
  useEffect(() => {
    const sb = supabase();
    let alive = true;
    sb.from("direct_messages")
      .select("*")
      .or(`and(sender_id.eq.${me.id},recipient_id.eq.${other}),and(sender_id.eq.${other},recipient_id.eq.${me.id})`)
      .order("id", { ascending: false })
      .limit(300)
      .then(({ data }) => {
        if (!alive) return;
        setMessages(((data ?? []) as DirectMessage[]).reverse());
        setLoaded(true);
      });
    const ch = sb
      .channel(`dm-${pair}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "direct_messages" }, (x) => {
        const m = x.new as DirectMessage;
        if (!inPair(m)) return;
        setMessages((list) => (list.some((y) => y.id === m.id) ? list : [...list, m]));
        if (m.sender_id === other) setTypingAt(0);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "direct_messages" }, (x) => {
        const m = x.new as DirectMessage;
        if (inPair(m)) setMessages((list) => list.map((y) => (y.id === m.id ? m : y)));
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if ((payload as { id: string }).id === other) setTypingAt(Date.now());
      })
      .subscribe();
    channelRef.current = ch;
    const sweep = setInterval(() => tick((n) => n + 1), 1500);
    return () => {
      alive = false;
      clearInterval(sweep);
      sb.removeChannel(ch);
      channelRef.current = null;
    };
  }, [me.id, other, pair]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep to the newest message, and mark the chat read while it's on screen.
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
    if (document.visibilityState === "visible") markRead(`dm:${other}`);
  }, [messages, other, markRead]);
  useEffect(() => {
    const onVis = () => document.visibilityState === "visible" && markRead(`dm:${other}`);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [other, markRead]);

  const chat = useMemo(() => messages.map(asChat), [messages]);
  const byId = useMemo(() => new Map(chat.map((m) => [m.id, m])), [chat]);
  // When they last read this chat: my messages up to then get ✓✓.
  const theirRead = reads.find((r) => r.user_id === other && r.chat === `dm:${me.id}`)?.last_read_at;
  const seenUntil = theirRead ? new Date(theirRead).getTime() : 0;
  const isOnline = online.includes(other);
  const typing = typingAt && Date.now() - typingAt < 4000;

  if (!them)
    return (
      <div className="emptystate">
        <h3>Chat not found</h3>
        This person isn’t on the team any more. <Link href="/chats">Back to chats</Link>
      </div>
    );

  return (
    <div className="dm">
      <section className="team-main">
        <header className="dm-h">
          <Link href="/chats" className="iconbtn" aria-label="Back to chats">
            {I.back}
          </Link>
          <span className={`pres${isOnline ? " on" : ""}`}>
            <Avatar p={them} />
          </span>
          <span className="dm-who">
            <b>{them.name}</b>
            <small>{typing ? "typing…" : isOnline ? "Online" : "Private chat"}</small>
          </span>
        </header>

        <div
          className="tm-list"
          ref={listRef}
          onClick={() => setActive(null)}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {!loaded && <div className="skel" style={{ height: 120 }} />}
          {loaded && !chat.length && (
            <div className="emptystate">
              <h3>Private chat with {them.name}</h3>
              Only the two of you can see this. Send a message, photo, file or voice note.
            </div>
          )}
          {chat.map((m, i) => {
            const prev = chat[i - 1];
            const mine = m.sender_id === me.id;
            return (
              <Fragment key={m.id}>
                {newDay(prev, m) && (
                  <div className="tm-day">
                    <span>{dayLabel(m.created_at)}</span>
                  </div>
                )}
                <Bubble
                  m={m}
                  idPrefix="pm"
                  grouped={isGrouped(prev, m)}
                  mine={mine}
                  canDelete={mine}
                  author={person(m.sender_id)}
                  parent={m.reply_to ? byId.get(m.reply_to) : undefined}
                  active={active === m.id}
                  onActivate={() => setActive((a) => (a === m.id ? null : m.id))}
                  ticks={mine && !m.deleted_at ? <Ticks seen={new Date(m.created_at).getTime() <= seenUntil} /> : undefined}
                  onReply={() => {
                    setReplyTo(m);
                    document.getElementById("dm-text")?.focus();
                  }}
                  onDelete={async () => {
                    const { error } = await supabase().rpc("delete_direct_message", { p_id: m.id });
                    if (error) toast(errText(error), "warn");
                  }}
                />
              </Fragment>
            );
          })}
        </div>

        <div className="tm-typing" aria-live="polite">
          {typing ? (
            <>
              <span className="dots">
                <i />
                <i />
                <i />
              </span>
              {them.name} is typing…
            </>
          ) : null}
        </div>

        <Composer
          id="dm-text"
          folder={`dm/${pair}`}
          placeholder={`Message ${them.name}…`}
          replyTo={replyTo ? { name: person(replyTo.sender_id)?.name ?? "Someone", text: previewText(replyTo) } : null}
          onCancelReply={() => setReplyTo(null)}
          onTyping={() => channelRef.current?.send({ type: "broadcast", event: "typing", payload: { id: me.id } })}
          onSend={async (body, file) => {
            const { data, error } = await supabase()
              .from("direct_messages")
              .insert({ recipient_id: other, body, reply_to: replyTo?.id ?? null, ...(file ?? {}) })
              .select("*")
              .single();
            if (error) {
              toast(errText(error), "warn");
              return false;
            }
            // Show it straight away; the live update is ignored as a duplicate.
            setMessages((list) => (list.some((y) => y.id === data.id) ? list : [...list, data as DirectMessage]));
            setReplyTo(null);
            stick.current = true;
            return true;
          }}
        />
      </section>
    </div>
  );
}
