import type { Deal, LenderSubmission, PaymentFreq, Profile, Role, StageId } from "./types";

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

// ───────────── Late limits ─────────────

/** Days a deal can sit in each stage before it's flagged late. Final stages never go late. */
export const LATE_AFTER: Partial<Record<StageId, number>> = { new: 1, docs: 2, ready: 1, submitted: 2, approved: 3, car: 7 };

export function isLate(d: Pick<Deal, "stage" | "stage_changed_at">) {
  const limit = LATE_AFTER[d.stage];
  return limit != null && daysSince(d.stage_changed_at) >= limit;
}

export function lateText(d: Pick<Deal, "stage" | "stage_changed_at">) {
  const limit = LATE_AFTER[d.stage] ?? 0;
  return `${daysSince(d.stage_changed_at)} days in ${STAGE[d.stage].name}. The limit is ${limit} day${limit === 1 ? "" : "s"}.`;
}

// ───────────── Money ─────────────

const CAD = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const CAD2 = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** $28,500 */
export const money = (n: number) => CAD.format(n);
/** $452.10 */
export const money2 = (n: number) => CAD2.format(n);
/** $28.5k, $1.2M: for tight spaces like cards and column headers. */
export function moneyShort(n: number) {
  const trim = (x: string) => x.replace(/\.0$/, "");
  if (n >= 1e6) return `$${trim((n / 1e6).toFixed(1))}M`;
  if (n >= 1e4) return `$${trim((n / 1e3).toFixed(n >= 1e5 ? 0 : 1))}k`;
  return money(n);
}
/** Reads "$28,500", "28.5k" or "28500" typed by a person. Empty → null, unreadable → NaN. */
export function parseMoney(v: string): number | null {
  const t = v.trim().toLowerCase().replace(/[$,\s]/g, "");
  if (!t) return null;
  const k = t.endsWith("k");
  const n = Number(k ? t.slice(0, -1) : t);
  return Number.isFinite(n) ? Math.round(n * (k ? 1000 : 1) * 100) / 100 : NaN;
}

export const FREQ: Record<PaymentFreq, { label: string; short: string; perYear: number }> = {
  monthly: { label: "Monthly", short: "mo", perYear: 12 },
  biweekly: { label: "Bi-weekly", short: "bi-wk", perYear: 26 },
  weekly: { label: "Weekly", short: "wk", perYear: 52 },
};

/** Standard loan payment for the amount, yearly rate (%) and term. An estimate: the lender's number wins. */
export function calcPayment(amount: number | null, rate: number | null, months: number | null, freq: PaymentFreq | null) {
  if (!amount || !months || rate == null) return null;
  const per = FREQ[freq ?? "monthly"].perYear;
  const n = Math.round((months / 12) * per);
  const r = rate / 100 / per;
  const p = r ? (amount * r) / (1 - Math.pow(1 + r, -n)) : amount / n;
  return Math.round(p * 100) / 100;
}

/** The approval that matters on a deal: the biggest approved amount, or the first approval. */
export function bestApproval(d: Pick<Deal, "lender_submissions">): LenderSubmission | undefined {
  const ok = d.lender_submissions.filter((l) => l.status === "approved");
  return [...ok].sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))[0];
}

/** "Scotiabank · $28.5k · 8.99% · 84 mo" */
export function approvalLine(l: LenderSubmission) {
  const bits = [l.lender];
  if (l.amount) bits.push(moneyShort(Number(l.amount)));
  if (l.rate != null) bits.push(`${Number(l.rate)}%`);
  if (l.term_months) bits.push(`${l.term_months} mo`);
  if (bits.length === 1 && l.terms) bits.push(l.terms.split(" · ")[0]);
  return bits.join(" · ");
}

/** The deal's dollar value for totals: approved amount, else the vehicle price. */
export function dealAmount(d: Deal): number | null {
  const a = bestApproval(d)?.amount ?? d.vehicle_price;
  return a == null ? null : Number(a);
}

// ───────────── Vehicle ─────────────

/** "2022 Toyota RAV4 LE", falling back to the older one-line description. */
export function vehicleLine(d: Deal) {
  const s = [d.vehicle_year, d.vehicle_make, d.vehicle_model, d.vehicle_trim].filter(Boolean).join(" ");
  return s || d.vehicle_desc || "";
}

export const CONDITION_PRESETS = ["Proof of income", "Proof of address", "Void cheque", "References", "Insurance"];
