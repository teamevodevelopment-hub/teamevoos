import type { Deal, Profile, Role, StageId } from "./types";

export const STAGES: { id: StageId; name: string; color: string }[] = [
  { id: "new", name: "New lead", color: "--s-new" },
  { id: "docs", name: "Docs collected", color: "--s-docs" },
  { id: "ready", name: "Ready to submit", color: "--s-ready" },
  { id: "submitted", name: "Submitted to lenders", color: "--s-sub" },
  { id: "approved", name: "Conditionally approved", color: "--s-appr" },
  { id: "car", name: "Car selection", color: "--s-car" },
  { id: "closed", name: "Closed", color: "--s-closed" },
  { id: "declined", name: "Declined", color: "--s-declined" },
  { id: "lost", name: "Lost", color: "--s-lost" },
];

export const STAGE = Object.fromEntries(STAGES.map((s) => [s.id, s])) as Record<
  StageId,
  (typeof STAGES)[number]
>;

const EARLY: StageId[] = ["new", "docs", "ready"];
export const FINAL: StageId[] = ["closed", "declined", "lost"];

export const ROLE_TITLE: Record<Role, string> = { admin: "Admin", lead: "Team lead", agent: "Agent" };

export interface Target {
  to: StageId;
  label?: string;
  primary?: boolean;
  danger?: boolean;
}

export function canSee(p: Profile, d: Deal) {
  return p.role !== "agent" || d.agent_id === p.id;
}

/**
 * The stage moves this person may make on this deal.
 * Mirrors public.move_deal in the database, which has the final say.
 */
export function targets(d: Deal, me: Profile): Target[] {
  const r = me.role;
  const s = d.stage;
  const out: Target[] = [];
  if (!canSee(me, d)) return out;
  if (s === "lost") {
    if ((r === "admin" || r === "lead") && d.prev_stage)
      out.push({ to: d.prev_stage, label: "Reopen deal", primary: true });
    return out;
  }
  if (s === "closed" || s === "declined") return out;
  if (EARLY.includes(s)) {
    const next: StageId | null = s === "new" ? "docs" : s === "docs" ? "ready" : null;
    if (s === "ready" && r === "admin") out.push({ to: "submitted", primary: true, label: "Submit to lenders" });
    if (next) out.push({ to: next, primary: true });
    EARLY.filter((x) => x !== s && x !== next).forEach((x) => out.push({ to: x }));
  }
  if (r === "admin" || r === "lead") {
    if (s === "submitted") out.push({ to: "approved", primary: true }, { to: "declined", danger: true });
    if (s === "approved") out.push({ to: "car", primary: true }, { to: "declined", danger: true });
    if (s === "car") out.push({ to: "closed", primary: true, label: "Customer signed · Close" });
  }
  if (r === "lead") out.push({ to: "lost", label: "Mark lost", danger: true });
  return out;
}

export function yourMove(stage: StageId, r: Role) {
  if (r === "admin") return ["ready", "submitted", "approved", "car"].includes(stage);
  if (r === "lead") return ["submitted", "approved", "car"].includes(stage);
  return ["new", "docs"].includes(stage);
}

export function waitingText(d: Deal) {
  switch (d.stage) {
    case "closed":
      return "Customer signed. This deal is done.";
    case "declined":
      return "Declined by every lender. Final.";
    case "lost":
      return "Lost. Sam or TJ can reopen it.";
    case "ready":
      return "Waiting on TJ to submit to lenders.";
    default:
      return "Waiting on TJ or Sam for the next step.";
  }
}

export const fullName = (d: Pick<Deal, "first_name" | "last_name">) => `${d.first_name} ${d.last_name}`;

export function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export function when(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const mins = Math.round((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today ${time}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}
