"use client";

import { usePortal } from "@/components/PortalProvider";
import { dealAmount, moneyShort } from "@/lib/stages";
import type { Deal } from "@/lib/types";

const DAY = 86_400_000;
const t = (iso: string) => new Date(iso).getTime();
const sum = (list: Deal[]) => list.reduce((n, d) => n + (dealAmount(d) ?? 0), 0);

/**
 * The team's numbers across the top of Deals. Agents only load their own deals,
 * so for them every figure is their own.
 */
export function Stats() {
  const { deals, me } = usePortal();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const closedMonth = deals.filter((d) => d.stage === "closed" && t(d.stage_changed_at) >= monthStart);
  const approvedOpen = deals.filter((d) => d.stage === "approved" || d.stage === "car");

  // Approval rate: deals sent to lenders in the last 30 days that have an answer.
  const recent = deals.filter((d) => d.lender_submissions.some((l) => t(l.submitted_at) >= Date.now() - 30 * DAY));
  const gotYes = recent.filter((d) => d.lender_submissions.some((l) => l.status === "approved"));
  const decided = recent.filter(
    (d) => gotYes.includes(d) || d.stage === "declined" || d.lender_submissions.every((l) => l.status === "declined"),
  );
  const rate = decided.length ? Math.round((gotYes.length / decided.length) * 100) : null;

  // Average days from lead to signed, over deals closed in the last 90 days.
  const closed90 = deals.filter((d) => d.stage === "closed" && t(d.stage_changed_at) >= Date.now() - 90 * DAY);
  const avgDays = closed90.length
    ? Math.round(closed90.reduce((n, d) => n + (t(d.stage_changed_at) - t(d.created_at)) / DAY, 0) / closed90.length)
    : null;

  const mine = me.role === "agent";
  return (
    <section className="stats" aria-label={mine ? "Your numbers" : "Team numbers"}>
      <Stat
        label="Closed this month"
        value={String(closedMonth.length)}
        sub={sum(closedMonth) ? moneyShort(sum(closedMonth)) : "No deals yet"}
        tone="good"
      />
      <Stat
        label="Approved, not closed"
        value={sum(approvedOpen) ? moneyShort(sum(approvedOpen)) : String(approvedOpen.length)}
        sub={`${approvedOpen.length} deal${approvedOpen.length === 1 ? "" : "s"}`}
      />
      <Stat
        label="Approval rate"
        value={rate == null ? "—" : `${rate}%`}
        sub={decided.length ? `${gotYes.length} of ${decided.length} · 30 days` : "No answers in 30 days"}
      />
      <Stat
        label="Days to close"
        value={avgDays == null ? "—" : String(avgDays)}
        sub={closed90.length ? `Average of ${closed90.length} · 90 days` : "No closed deals in 90 days"}
      />
    </section>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "good" }) {
  return (
    <div className={`stat${tone ? ` ${tone}` : ""}`}>
      <span className="stat-l">{label}</span>
      <b className="stat-v tnum">{value}</b>
      <span className="stat-s">{sub}</span>
    </div>
  );
}
