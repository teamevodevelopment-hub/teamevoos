"use client";

import { useRef, useState } from "react";
import { usePortal } from "@/components/PortalProvider";
import { useIsMobile } from "@/components/Shell";
import { Avatar, Chip, I } from "@/components/ui";
import { FINAL, STAGE, STAGES, daysSince, fullName, targets, yourMove } from "@/lib/stages";
import type { Deal, StageId } from "@/lib/types";

function subline(d: Deal) {
  const subs = d.lender_submissions;
  switch (d.stage) {
    case "new":
      return d.phone || "No phone yet";
    case "docs":
      return d.licence_front && d.licence_back ? "Licence front and back in" : d.licence_front ? "Waiting on licence back" : "Waiting on licence";
    case "ready":
      return d.dealertrack_no ? <span className="mono">{d.dealertrack_no}</span> : "Dealertrack # missing";
    case "submitted":
      return subs.map((l) => l.lender).join(", ") || "No lenders added yet";
    case "approved": {
      const a = subs.find((l) => l.status === "approved");
      return a ? `${a.lender}${a.terms ? " · " + a.terms.split(" · ")[0] : ""}` : "Approved";
    }
    case "car":
      return d.vehicle_desc || "Choosing a vehicle";
    case "closed":
      return d.vehicle_desc ? `${d.vehicle_desc}${d.vehicle_price ? " · $" + Number(d.vehicle_price).toLocaleString("en-CA") : ""}` : "Closed";
    case "declined":
      return `Declined by ${subs.length} lender${subs.length === 1 ? "" : "s"}`;
    case "lost":
      return d.lost_reason;
  }
}

function Card({ d, draggable }: { d: Deal; draggable: boolean }) {
  const { person, openDeal, notifications, flash } = usePortal();
  const days = daysSince(d.stage_changed_at);
  const late = days >= 3 && !FINAL.includes(d.stage);
  const unread = notifications.some((n) => n.deal_id === d.id && !n.read_at);
  return (
    <article
      className={`card${flash === d.id ? " flash" : ""}`}
      tabIndex={0}
      data-id={d.id}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(d.id));
        e.dataTransfer.effectAllowed = "move";
        (e.currentTarget as HTMLElement).classList.add("dragging");
      }}
      onDragEnd={(e) => (e.currentTarget as HTMLElement).classList.remove("dragging")}
      onClick={() => openDeal(d.id)}
      onKeyDown={(e) => e.key === "Enter" && openDeal(d.id)}
    >
      <div className="card-t">
        {fullName(d)}
        {unread && <span className="dot" title="Unread" />}
      </div>
      <div className="card-s">{subline(d)}</div>
      <div className="card-m">
        <Avatar p={person(d.agent_id)} size="sm" />
        <span className={late ? "late" : ""}>
          {I.clock}
          {days === 0 ? "Today" : `${days}d`}
        </span>
        {d.lender_submissions.length > 0 && (
          <span>
            {I.bank}
            {d.lender_submissions.length}
          </span>
        )}
      </div>
    </article>
  );
}

export default function DealsPage() {
  const { deals, dealsLoaded, me, layout, tryMove, person, openDeal } = usePortal();
  const isMobile = useIsMobile();
  const [mstage, setMstage] = useState<StageId>(me.role === "admin" ? "ready" : me.role === "lead" ? "submitted" : "new");
  const [over, setOver] = useState<{ col: StageId; ok: boolean } | null>(null);
  const dragId = useRef<number | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

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

  if (isMobile) {
    const list = deals.filter((d) => d.stage === mstage);
    const idx = STAGES.findIndex((s) => s.id === mstage);
    const go = (delta: number) => {
      const n = STAGES[Math.max(0, Math.min(STAGES.length - 1, idx + delta))];
      setMstage(n.id);
      document.querySelector(`[data-mstage="${n.id}"]`)?.scrollIntoView({ inline: "center", block: "nearest" });
    };
    return (
      <>
        <div className="mstages">
          {STAGES.map((s) => (
            <button key={s.id} className="mstage" data-mstage={s.id} aria-pressed={mstage === s.id} onClick={() => setMstage(s.id)}>
              {s.name}
              <span className="n">{deals.filter((d) => d.stage === s.id).length}</span>
            </button>
          ))}
        </div>
        <div className="mhead">
          <Chip stage={mstage} />
          {yourMove(mstage, me.role) && list.length ? <span className="yourmove">Your move</span> : <span>Swipe for next stage</span>}
        </div>
        <div
          className="mlist"
          onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
          onTouchEnd={(e) => {
            const t = touch.current;
            touch.current = null;
            if (!t) return;
            const dx = e.changedTouches[0].clientX - t.x;
            const dy = e.changedTouches[0].clientY - t.y;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
          }}
        >
          {list.length ? (
            list.map((d) => <Card key={d.id} d={d} draggable={false} />)
          ) : (
            <div className="emptystate">
              <h3>Nothing here</h3>No deals in {STAGE[mstage].name} right now.
            </div>
          )}
        </div>
      </>
    );
  }

  if (layout === "table") {
    const order = STAGES.map((s) => s.id);
    const rows = [...deals].sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));
    return (
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Stage</th>
              <th>Agent</th>
              <th>Lenders</th>
              <th>In stage</th>
              <th>Dealertrack</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const days = daysSince(d.stage_changed_at);
              return (
                <tr key={d.id} onClick={() => openDeal(d.id)}>
                  <td>
                    <b>{fullName(d)}</b>
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
                  <td className="tnum">{days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`}</td>
                  <td className="mono">{d.dealertrack_no || <span style={{ color: "var(--fg-3)" }}>—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
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
        const cls = over?.col === s.id ? (over.ok ? " over" : " nope") : "";
        return (
          <section
            key={s.id}
            className={`col${s.id === "declined" || s.id === "lost" ? " muted" : ""}${cls}`}
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
              {yourMove(s.id, me.role) && list.length > 0 && <span className="yourmove">Your move</span>}
            </div>
            <div className="col-b">
              {list.length ? list.map((d) => <Card key={d.id} d={d} draggable />) : <div className="empty-col">No deals</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
