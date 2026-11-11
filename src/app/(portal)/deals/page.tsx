"use client";

import { useEffect, useRef, useState } from "react";
import { usePortal } from "@/components/PortalProvider";
import { useIsMobile } from "@/components/Shell";
import { Avatar, Chip, I } from "@/components/ui";
import { STAGE, STAGES, approvalLine, bestApproval, daysSince, dealAmount, fullName, isLate, lateText, moneyShort, targets, vehicleLine, yourMove } from "@/lib/stages";
import { Stats } from "./Stats";
import { TodayHero } from "@/components/Showroom";
import type { Deal, StageId } from "@/lib/types";

function subline(d: Deal) {
  const subs = d.lender_submissions;
  switch (d.stage) {
    case "new":
      return d.phone || "No phone yet";
    case "docs":
      return d.licence_front && d.licence_back
        ? "Licence front and back in"
        : d.licence_front || d.licence_back
          ? `Licence ${d.licence_front ? "front" : "back"} in`
          : d.phone || "No licence photos";
    case "ready":
      return d.dealertrack_no ? <span className="mono">{d.dealertrack_no}</span> : "Dealertrack # missing";
    case "submitted":
      return subs.map((l) => l.lender).join(", ") || "No lenders added yet";
    case "approved": {
      const a = bestApproval(d);
      return a ? approvalLine(a) : "Approved";
    }
    case "car": {
      const v = vehicleLine(d);
      const a = bestApproval(d);
      return v || (a ? `Choosing a vehicle · ${approvalLine(a)}` : "Choosing a vehicle");
    }
    case "closed": {
      const v = vehicleLine(d);
      const amt = dealAmount(d);
      return [v, amt ? moneyShort(amt) : ""].filter(Boolean).join(" · ") || "Closed";
    }
    case "declined":
      return `Declined by ${subs.length} lender${subs.length === 1 ? "" : "s"}`;
    case "lost":
      return d.lost_reason;
  }
}

/** Days in the current stage. Late deals get a warning icon and the word "late", not just a colour. */
function InStage({ d, short }: { d: Deal; short?: boolean }) {
  const days = daysSince(d.stage_changed_at);
  const late = isLate(d);
  const text = days === 0 ? "Today" : short ? `${days}d` : `${days} day${days === 1 ? "" : "s"}`;
  return (
    <span className={late ? "late" : ""} title={late ? lateText(d) : undefined}>
      {late ? I.alert : I.clock}
      {text}
      {late && (short ? <span className="sr-only"> in stage, late</span> : " · late")}
    </span>
  );
}

function Card({ d, draggable }: { d: Deal; draggable: boolean }) {
  const { me, person, openDeal, notifications, flash, unreadChats } = usePortal();
  const unread = !!unreadChats[`deal:${d.id}`] || notifications.some((n) => n.deal_id === d.id && !n.read_at);
  const conds = d.deal_conditions ?? [];
  const condsDone = conds.filter((c) => c.done_at).length;
  const amount = dealAmount(d);
  return (
    <article
      className={`card${flash === d.id ? " flash" : ""}${isLate(d) && yourMove(d.stage, me.role) ? " is-late" : ""}`}
      style={{ ["--c" as string]: `var(${STAGE[d.stage].color})` }}
      tabIndex={0}
      data-id={d.id}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(d.id));
        e.dataTransfer.effectAllowed = "move";
        (e.currentTarget as HTMLElement).classList.add("dragging");
      }}
      onDragEnd={(e) => (e.currentTarget as HTMLElement).classList.remove("dragging")}
      role="button"
      onClick={() => openDeal(d.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDeal(d.id);
        }
      }}
    >
      <div className="card-t">
        <span className="card-n">{fullName(d)}</span>
        {unread && (
          <span className="dot" title="Unread messages">
            <span className="sr-only">Unread messages</span>
          </span>
        )}
        {amount != null && <span className="card-amt tnum">{moneyShort(amount)}</span>}
      </div>
      <div className="card-s">{subline(d)}</div>
      <div className="card-m">
        <Avatar p={person(d.agent_id)} size="sm" />
        <InStage d={d} short />
        {d.lender_submissions.length > 0 && (
          <span className="ldots" title={d.lender_submissions.map((l) => `${l.lender}: ${l.status}`).join(", ")}>
            {I.bank}
            {d.lender_submissions.map((l) => (
              <i key={l.id} className={l.status} />
            ))}
            <span className="sr-only">
              {d.lender_submissions.map((l) => `${l.lender} ${l.status}`).join(", ")}
            </span>
          </span>
        )}
        {conds.length > 0 && (
          <span className={condsDone === conds.length ? "conds-done" : ""} title={`${condsDone} of ${conds.length} conditions received`}>
            {I.check}
            {condsDone}/{conds.length}
          </span>
        )}
      </div>
    </article>
  );
}

export default function DealsPage() {
  const { deals, dealsLoaded, me, layout, tryMove, person, openDeal } = usePortal();
  const isMobile = useIsMobile();
  const [mstage] = useState<StageId>(me.role === "admin" ? "ready" : me.role === "lead" ? "submitted" : "new");
  const [over, setOver] = useState<{ col: StageId; ok: boolean } | null>(null);
  const dragId = useRef<number | null>(null);

  if (!dealsLoaded)
    return (
      <div className="board">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skel" style={{ flex: "0 0 268px", height: 320 }} />
        ))}
      </div>
    );

  if (!deals.length)
    return (
      <div className="emptystate">
        <h3>No deals yet</h3>
        Add your first customer with New deal. They’ll show up here as soon as they’re saved.
      </div>
    );

  if (isMobile) return <PhoneDeals start={mstage} />;

  if (layout === "table") {
    const order = STAGES.map((s) => s.id);
    const rows = [...deals].sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));
    return (
      <>
      <TodayHero />
      <Stats />
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Stage</th>
              <th>Agent</th>
              <th>Lenders</th>
              <th>Amount</th>
              <th>In stage</th>
              <th>Dealertrack</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const amt = dealAmount(d);
              return (
                <tr key={d.id} onClick={() => openDeal(d.id)}>
                  <td>
                    <button
                      className="rowlink"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDeal(d.id);
                      }}
                    >
                      {fullName(d)}
                    </button>
                    <div style={{ color: "var(--fg-3)", fontSize: 12.5 }}>{d.city}</div>
                  </td>
                  <td>
                    <Chip stage={d.stage} />
                  </td>
                  <td>
                    <span className="who">
                      <Avatar p={person(d.agent_id)} size="sm" />
                      {person(d.agent_id)?.name}
                    </span>
                  </td>
                  <td className="tnum">
                    {d.lender_submissions.length ? (
                      d.lender_submissions.map((l) => (
                        <span key={l.id} className={`pill ${l.status}`} style={{ marginRight: 4 }}>
                          {l.lender}
                        </span>
                      ))
                    ) : (
                      <span style={{ color: "var(--fg-3)" }}>—</span>
                    )}
                  </td>
                  <td className="tnum">{amt ? moneyShort(amt) : <span style={{ color: "var(--fg-3)" }}>—</span>}</td>
                  <td className="tnum instage">
                    <InStage d={d} />
                  </td>
                  <td className="mono">{d.dealertrack_no || <span style={{ color: "var(--fg-3)" }}>—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>
    );
  }

  return (
    <div className="deals-wrap">
    <TodayHero />
    <Stats />
    <div
      className="board"
      onDragStartCapture={(e) => {
        const card = (e.target as HTMLElement).closest<HTMLElement>(".card");
        dragId.current = card?.dataset.id ? Number(card.dataset.id) : null;
      }}
      onDragEnd={() => {
        dragId.current = null;
        setOver(null);
      }}
    >
      {STAGES.map((s) => {
        const list = deals.filter((d) => d.stage === s.id);
        const total = list.reduce((t, d) => t + (dealAmount(d) ?? 0), 0);
        const cls = over?.col === s.id ? (over.ok ? " over" : " nope") : "";
        return (
          <section
            key={s.id}
            data-col={s.id}
            className={`col${s.id === "declined" || s.id === "lost" ? " muted" : ""}${cls}`}
            style={{ ["--c" as string]: `var(${s.color})` }}
            onDragOver={(e) => {
              e.preventDefault();
              const d = deals.find((x) => x.id === dragId.current);
              if (!d) return;
              const ok = d.stage === s.id || targets(d, me).some((t) => t.to === s.id);
              if (over?.col !== s.id || over.ok !== ok) setOver({ col: s.id, ok });
            }}
            onDragLeave={(e) => {
              if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = Number(e.dataTransfer.getData("text/plain")) || dragId.current;
              const d = deals.find((x) => x.id === id);
              if (d) tryMove(d, s.id);
            }}
          >
            <div className="col-h">
              <Chip stage={s.id} />
              <span className="n">{list.length}</span>
              {total > 0 && <span className="n tnum colsum">{moneyShort(total)}</span>}
              {yourMove(s.id, me.role) && list.length > 0 && <span className="yourmove">Your move</span>}
            </div>
            <div className="col-b">
              {list.length ? list.map((d) => <Card key={d.id} d={d} draggable />) : <div className="empty-col">No deals</div>}
            </div>
          </section>
        );
      })}
    </div>
    </div>
  );
}

/**
 * Deals on a phone: swipe left and right through the stages (each stage is a page that snaps into place),
 * or tap a stage in the strip above.
 */
function PhoneDeals({ start }: { start: StageId }) {
  const { deals, me } = usePortal();
  const [at, setAt] = useState(() => Math.max(0, STAGES.findIndex((s) => s.id === start)));
  const pager = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);

  // Open on the starting stage without animating.
  useEffect(() => {
    const el = pager.current;
    if (el) el.scrollLeft = at * el.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Keep the active stage visible in the strip.
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [at]);

  const go = (i: number) => {
    const el = pager.current;
    if (!el) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: i * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
    setAt(i);
  };

  return (
    <>
      <TodayHero />
      <Stats />
      <div className="mstages" ref={strip} role="tablist" aria-label="Stages">
        {STAGES.map((s, i) => {
          const list = deals.filter((d) => d.stage === s.id);
          const total = list.reduce((t, d) => t + (dealAmount(d) ?? 0), 0);
          return (
            <button
              key={s.id}
              role="tab"
              className="mstage"
              data-i={i}
              aria-selected={at === i}
              style={{ ["--c" as string]: `var(${s.color})` }}
              onClick={() => go(i)}
            >
              <span className="ms-name">{s.name}</span>
              <span className="ms-meta">
                <b className="n">{list.length}</b>
                {total > 0 && <span className="tnum">{moneyShort(total)}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mtrack" aria-hidden>
        <i style={{ width: `${((at + 1) / STAGES.length) * 100}%` }} />
      </div>
      <div
        className="mpager"
        ref={pager}
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = Math.round(el.scrollLeft / el.clientWidth);
          if (i !== at && i >= 0 && i < STAGES.length) setAt(i);
        }}
      >
        {STAGES.map((s, i) => {
          const list = deals.filter((d) => d.stage === s.id);
          return (
            <section key={s.id} className="mpage" aria-label={s.name} aria-hidden={i !== at} inert={i !== at}>
              <div className="mhead">
                <Chip stage={s.id} />
                {yourMove(s.id, me.role) && list.length ? <span className="yourmove">Your move</span> : <span>{i < STAGES.length - 1 ? "Swipe for next stage" : ""}</span>}
              </div>
              <div className="mlist">
                {list.length ? (
                  list.map((d) => <Card key={d.id} d={d} draggable={false} />)
                ) : (
                  <div className="emptystate mini">
                    {I.car}
                    <h3>Nothing here</h3>No deals in {s.name} right now.
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
