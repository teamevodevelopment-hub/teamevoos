"use client";

import { usePortal } from "@/components/PortalProvider";
import { CountUp } from "@/components/Showroom";
import { STAGE, dealAmount, moneyShort } from "@/lib/stages";
import type { Deal, StageId } from "@/lib/types";

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
        chart={<MonthLine closed={closedMonth} />}
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
      <Pipeline deals={deals} />
    </section>
  );
}

function Stat({ label, value, sub, tone, chart }: { label: string; value: string; sub: string; tone?: "good"; chart?: React.ReactNode }) {
  return (
    <div className={`stat${tone ? ` ${tone}` : ""}`}>
      {chart}
      <span className="stat-l">{label}</span>
      <b className="stat-v tnum">
        <CountUp text={value} />
      </b>
      <span className="stat-s">{sub}</span>
    </div>
  );
}

/** Closings so far this month, as a small rising line in the corner of the card. */
function MonthLine({ closed }: { closed: Deal[] }) {
  const today = new Date().getDate();
  if (today < 2) return null;
  const perDay = Array.from({ length: today }, (_, i) => closed.filter((d) => new Date(d.stage_changed_at).getDate() <= i + 1).length);
  const max = Math.max(1, perDay[perDay.length - 1]);
  const W = 96;
  const H = 30;
  const pts = perDay.map((n, i) => `${((i / (today - 1)) * W).toFixed(1)},${(H - 2 - (n / max) * (H - 6)).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} aria-hidden preserveAspectRatio="none">
      <polygon points={`0,${H} ${pts} ${W},${H}`} />
      <polyline points={pts} />
    </svg>
  );
}

/** Deals in each stage of the road, as bars. Click a bar to jump to that column on the board. */
const ROAD: StageId[] = ["new", "docs", "ready", "submitted", "approved", "car"];
function Pipeline({ deals }: { deals: Deal[] }) {
  const counts = ROAD.map((s) => deals.filter((d) => d.stage === s));
  const max = Math.max(1, ...counts.map((c) => c.length));
  const jump = (s: StageId) =>
    document.querySelector(`[data-col="${s}"]`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  return (
    <div className="stat pipe">
      <span className="stat-l">Pipeline</span>
      <div className="pipe-bars" role="list">
        {ROAD.map((s, i) => {
          const list = counts[i];
          const money = list.reduce((t, d) => t + (dealAmount(d) ?? 0), 0);
          return (
            <button
              key={s}
              role="listitem"
              className="pipe-b"
              style={{ ["--c" as string]: `var(${STAGE[s].color})`, ["--h" as string]: `${Math.max(6, (list.length / max) * 100)}%` }}
              title={`${STAGE[s].name}: ${list.length} deal${list.length === 1 ? "" : "s"}${money ? ` · ${moneyShort(money)}` : ""}`}
              aria-label={`${STAGE[s].name}: ${list.length}`}
              onClick={() => jump(s)}
            >
              <span className="pipe-n tnum">{list.length}</span>
              <i />
            </button>
          );
        })}
      </div>
    </div>
  );
}
