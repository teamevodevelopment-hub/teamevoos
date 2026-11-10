"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePortal } from "@/components/PortalProvider";
import { Avatar, I } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { previewText } from "@/lib/chatFiles";
import type { DirectMessage, TeamMessage } from "@/lib/types";

/** "2:14 p.m." today, "Yesterday", or "Nov 8". */
function stamp(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

/** Every chat in one list, like WhatsApp: the team room, then each teammate. */
export default function ChatsPage() {
  const { me, profiles, person, unreadChats, online } = usePortal();
  const [lastTeam, setLastTeam] = useState<TeamMessage | null>(null);
  const [lastDm, setLastDm] = useState<Record<string, DirectMessage>>({});

  const load = useCallback(async () => {
    const sb = supabase();
    const [t, d] = await Promise.all([
      sb.from("team_messages").select("*").order("id", { ascending: false }).limit(1),
      sb.from("direct_messages").select("*").order("id", { ascending: false }).limit(500),
    ]);
    setLastTeam(((t.data ?? [])[0] as TeamMessage) ?? null);
    const latest: Record<string, DirectMessage> = {};
    for (const m of (d.data ?? []) as DirectMessage[]) {
      const other = m.sender_id === me.id ? m.recipient_id : m.sender_id;
      if (!latest[other]) latest[other] = m;
    }
    setLastDm(latest);
  }, [me.id]);

  useEffect(() => {
    load();
    const ch = supabase()
      .channel("chats-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "direct_messages" }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "team_messages" }, load)
      .subscribe();
    return () => {
      supabase().removeChannel(ch);
    };
  }, [load]);

  const people = profiles
    .filter((p) => p.id !== me.id)
    .sort((a, b) => {
      const ta = lastDm[a.id]?.created_at ?? "";
      const tb = lastDm[b.id]?.created_at ?? "";
      return tb.localeCompare(ta) || a.name.localeCompare(b.name);
    });

  const teamPreview = lastTeam
    ? lastTeam.kind === "celebration"
      ? `${lastTeam.body === "closed" ? "🎉" : "✅"} ${person(lastTeam.author_id)?.name ?? "Someone"} ${lastTeam.body === "closed" ? "closed a deal" : "got an approval"}`
      : `${lastTeam.author_id === me.id ? "You" : (person(lastTeam.author_id)?.name ?? "Someone")}: ${previewText(lastTeam)}`
    : "Wins, questions and celebrations";

  return (
    <div className="chats">
      <Link href="/team" className={`chatrow${unreadChats.team ? " unread" : ""}`}>
        <span className="chat-av room">{I.team}</span>
        <span className="chat-t">
          <span className="chat-l1">
            <b>Team room</b>
            {lastTeam && <small>{stamp(lastTeam.created_at)}</small>}
          </span>
          <span className="chat-l2">
            <span className="chat-prev">{teamPreview}</span>
            {unreadChats.team ? <span className="chat-n tnum">{unreadChats.team}</span> : null}
          </span>
        </span>
      </Link>
      <div className="chats-h">Private chats</div>
      {people.map((p) => {
        const m = lastDm[p.id];
        const n = unreadChats[`dm:${p.id}`];
        return (
          <Link key={p.id} href={`/chats/${p.id}`} className={`chatrow${n ? " unread" : ""}`}>
            <span className={`pres${online.includes(p.id) ? " on" : ""}`}>
              <Avatar p={p} size="lg" />
            </span>
            <span className="chat-t">
              <span className="chat-l1">
                <b>{p.name}</b>
                {m && <small>{stamp(m.created_at)}</small>}
              </span>
              <span className="chat-l2">
                <span className="chat-prev">
                  {m ? `${m.sender_id === me.id ? "You: " : ""}${previewText(m)}` : online.includes(p.id) ? "Online now · say hi" : "Start a private chat"}
                </span>
                {n ? <span className="chat-n tnum">{n}</span> : null}
              </span>
            </span>
          </Link>
        );
      })}
      <p className="chats-note">
        {I.lock}Private chats are only seen by the two of you. Deal chats are inside each deal.
      </p>
    </div>
  );
}
