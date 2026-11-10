"use client";

import type { ReactNode } from "react";
import { STAGE } from "@/lib/stages";
import type { Profile, StageId } from "@/lib/types";

const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const I: Record<string, ReactNode> = {
  board: (
    <svg viewBox="0 0 24 24" {...s}>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="10" y="4" width="5" height="11" rx="1.5" />
      <rect x="17" y="4" width="4" height="7" rx="1.5" />
    </svg>
  ),
  inbox: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M4 13l2.5-7.5A2 2 0 0 1 8.4 4h7.2a2 2 0 0 1 1.9 1.5L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" {...s} strokeWidth={2}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  gear: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </svg>
  ),
  chat: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
    </svg>
  ),
  bank: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M3 10l9-5 9 5M5 10v8M19 10v8M9.5 10v8M14.5 10v8M3 20h18" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 2" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" {...s} strokeWidth={2}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  camera: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" {...s}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  ),
  send: (
    <svg viewBox="0 0 24 24" {...s} strokeWidth={2}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  bulb: (
    <svg viewBox="0 0 24 24" {...s} width="18" height="18">
      <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
    </svg>
  ),
  hourglass: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9" />
    </svg>
  ),
  logo: (
    <svg viewBox="0 0 24 24" {...s} strokeWidth={2.2}>
      <path d="M4 16l5-5 4 4 7-8" />
      <path d="M15 7h5v5" />
    </svg>
  ),
};

const AV_COLORS = ["--av-tj", "--av-sam", "--av-corbin", "--av-ahmed"];

/** Stable colour per person: TJ, Sam, Corbin and Ahmed keep the prototype's colours. */
function avColor(p: Pick<Profile, "name">) {
  const known: Record<string, string> = { TJ: "--av-tj", Sam: "--av-sam", Corbin: "--av-corbin", Ahmed: "--av-ahmed" };
  if (known[p.name]) return known[p.name];
  let h = 0;
  for (const c of p.name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}

export function initials(name: string) {
  if (name.length <= 2) return name.toUpperCase();
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : name[0].toUpperCase();
}

export function Avatar({ p, size }: { p: Pick<Profile, "name"> | undefined; size?: "sm" | "lg" }) {
  if (!p) return <span className={`av ${size ?? ""}`}>?</span>;
  return (
    <span className={`av ${size ?? ""}`} style={{ ["--c" as string]: `var(${avColor(p)})` }} title={p.name}>
      {initials(p.name)}
    </span>
  );
}

export function Chip({ stage }: { stage: StageId }) {
  const st = STAGE[stage];
  return (
    <span className="chip" style={{ ["--c" as string]: `var(${st.color})` }}>
      {st.name}
    </span>
  );
}

/** Highlights @Name for every team member's name. */
export function Mentionized({ text, names }: { text: string; names: string[] }) {
  if (!names.length) return <>{text}</>;
  const esc = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(@(?:${esc}))(?![\\w])`, "gi");
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="mention">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
