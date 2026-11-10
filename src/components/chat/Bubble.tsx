"use client";

import { Fragment, type ReactNode } from "react";
import { usePortal } from "../PortalProvider";
import { Avatar, Chip, I, Mentionized } from "../ui";
import { Attachment } from "./Attachment";
import { PICKER } from "./Composer";
import { fullName } from "@/lib/stages";
import { previewText } from "@/lib/chatFiles";
import type { ChatRead, Deal, FileFields, Profile } from "@/lib/types";

/** Any chat message: team room, deal chat or private chat. */
export interface ChatMsg extends FileFields {
  id: number;
  author_id: string | null;
  body: string;
  created_at: string;
  deleted_at?: string | null;
  reply_to?: number | null;
  kind?: string;
}

export const QUICK = ["👍", "🔥", "😂", "🎉", "❤️", "💯", "👀", "🙏"];
export const DEAL_TOKEN = /#\[deal:(\d+)\]/g;
const ONLY_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️|\s)+$/u;

export function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" });
}
export const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });

export const newDay = (prev: ChatMsg | undefined, m: ChatMsg) => !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();

/** Back-to-back messages from the same person within 5 minutes share one header. */
export const isGrouped = (prev: ChatMsg | undefined, m: ChatMsg) =>
  !!prev &&
  !newDay(prev, m) &&
  (prev.kind ?? "user") === "user" &&
  (m.kind ?? "user") === "user" &&
  prev.author_id === m.author_id &&
  !m.reply_to &&
  new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;

export function DealChip({ id, deals }: { id: number; deals: Deal[] }) {
  const { openDeal } = usePortal();
  const d = deals.find((x) => x.id === id);
  if (!d)
    return (
      <span className="dealchip locked">
        {I.lock}Private deal
      </span>
    );
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

export function Body({ text }: { text: string }) {
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

/** ✓ sent, ✓✓ seen. */
export function Ticks({ seen }: { seen: boolean }) {
  return (
    <span className={`ticks${seen ? " seen" : ""}`} title={seen ? "Seen" : "Sent"} aria-label={seen ? "Seen" : "Sent"}>
      {seen ? I.checks : I.check}
    </span>
  );
}

/** Names of everyone (but me and the author) who has read up to this message. */
export function seenBy(reads: ChatRead[], chat: string, m: ChatMsg, me: string, person: (id: string) => Profile | undefined) {
  const t = new Date(m.created_at).getTime();
  return reads
    .filter((r) => r.chat === chat && r.user_id !== me && r.user_id !== m.author_id && new Date(r.last_read_at).getTime() >= t)
    .map((r) => person(r.user_id)?.name)
    .filter(Boolean) as string[];
}

export function Bubble(props: {
  m: ChatMsg;
  grouped: boolean;
  mine: boolean;
  canDelete: boolean;
  author?: Profile;
  parent?: ChatMsg;
  reactions?: { emoji: string; user_id: string }[];
  onReact?: (emoji: string) => void;
  pickerOpen?: boolean;
  onPicker?: () => void;
  active: boolean;
  onActivate: () => void;
  onReply?: () => void;
  onDelete?: () => void;
  /** Read marks shown after the time (private chats). */
  ticks?: ReactNode;
  /** A line under the message, e.g. "Seen by Sam, TJ". */
  footer?: ReactNode;
  idPrefix?: string;
}) {
  const { m, grouped, author, parent, reactions = [] } = props;
  const { me, person } = usePortal();
  const deleted = !!m.deleted_at;
  const bigEmoji = !deleted && !m.file_path && ONLY_EMOJI.test(m.body) && [...m.body.replace(/\s/g, "")].length <= 6;
  const counts = new Map<string, string[]>();
  for (const r of reactions) counts.set(r.emoji, [...(counts.get(r.emoji) ?? []), r.user_id]);
  const pre = props.idPrefix ?? "tm";

  return (
    <div id={`${pre}-${m.id}`} className={`tm${grouped ? " grouped" : ""}${props.active ? " active" : ""}${props.mine ? " mine" : ""}`} onClick={props.onActivate}>
      <div className="tm-av">{!grouped && <Avatar p={author} />}</div>
      <div className="tm-b">
        {!grouped && (
          <div className="tm-h">
            <b>{author?.name ?? "Former team member"}</b>
            <small>{clock(m.created_at)}</small>
            {props.ticks}
          </div>
        )}
        {parent && (
          <button
            className="tm-quote"
            onClick={(e) => {
              e.stopPropagation();
              document.getElementById(`${pre}-${parent.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          >
            {I.reply}
            <b>{person(parent.author_id)?.name}</b>
            <span>{previewText(parent)}</span>
          </button>
        )}
        {!deleted && <Attachment m={m} />}
        {(deleted || m.body) && (
          <div className={`tm-x${bigEmoji ? " big" : ""}${deleted ? " deleted" : ""}`}>
            {deleted ? "Message deleted" : <Body text={m.body} />}
            {grouped && props.ticks && <span className="tm-inline-time">{props.ticks}</span>}
          </div>
        )}
        {!m.body && !deleted && grouped && props.ticks && <div className="tm-x">{props.ticks}</div>}
        {counts.size > 0 && (
          <div className="reacts">
            {[...counts.entries()].map(([emoji, users]) => (
              <button
                key={emoji}
                className={`react${users.includes(me.id) ? " mine" : ""}`}
                title={users.map((u) => person(u)?.name).join(", ")}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onReact?.(emoji);
                }}
              >
                <span>{emoji}</span>
                <b className="tnum">{users.length}</b>
              </button>
            ))}
          </div>
        )}
        {props.footer}
      </div>
      {!deleted && (props.onReact || props.onReply || props.canDelete) && (
        <div className="tm-actions" onClick={(e) => e.stopPropagation()}>
          {props.onReact &&
            QUICK.slice(0, 4).map((e) => (
              <button key={e} onClick={() => props.onReact!(e)} aria-label={`React ${e}`}>
                {e}
              </button>
            ))}
          {props.onPicker && (
            <button onClick={props.onPicker} aria-label="More reactions">
              {I.smile}
            </button>
          )}
          {props.onReply && (
            <button onClick={props.onReply} aria-label="Reply">
              {I.reply}
            </button>
          )}
          {props.canDelete && props.onDelete && (
            <button onClick={props.onDelete} aria-label="Delete message" className="del">
              {I.trash}
            </button>
          )}
          {props.pickerOpen && props.onReact && (
            <div className="emoji-grid" role="listbox">
              {[...QUICK, ...PICKER.filter((x) => !QUICK.includes(x))].map((e) => (
                <button key={e} onClick={() => props.onReact!(e)}>
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
