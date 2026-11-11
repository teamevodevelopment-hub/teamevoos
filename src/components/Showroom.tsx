"use client";

// "Showroom" pieces shared across screens: numbers that count up, the stage journey, and the Today header.
import { useEffect, useRef, useState } from "react";
import { usePortal, isOpen } from "./PortalProvider";
import { I } from "./ui";
import { STAGE, dealAmount, isLate, moneyShort, yourMove } from "@/lib/stages";
import type { Deal, StageId } from "@/lib/types";

const reduced = () => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Shows text like "$57k", "100%" or "3", counting the number up from 0 the first time it appears
 * and from the old value when it changes. Screen readers get the final text straight away.
 */
export function CountUp({ text, ms = 700 }: { text: string; ms?: number }) {
  const m = /^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/.exec(text);
  const target = m ? Number(m[2].replace(/,/g, "")) : NaN;
  const decimals = m && m[2].includes(".") ? m[2].split(".")[1].length : 0;
  const [shown, setShown] = useState(target);
  const from = useRef(0);

  useEffect(() => {
    if (!Number.isFinite(target) || reduced()) {
      setShown(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(a + (target - a) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);

  if (!m || !Number.isFinite(target)) return <>{text}</>;
  const body = shown.toLocaleString("en-CA", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (
    <>
      <span aria-hidden>
        {m[1]}
        {body}
        {m[3]}
      </span>
      <span className="sr-only">{text}</span>
    </>
  );
}

/** The main road a deal travels. Declined and Lost leave the road where they stopped. */
const ROAD: StageId[] = ["new", "docs", "ready", "submitted", "approved", "car", "closed"];
const SHORT: Record<StageId, string> = {
  new: "Lead",
  docs: "Docs",
  ready: "Ready",
  submitted: "Lenders",
  approved: "Approved",
  car: "Car",
  closed: "Closed",
  declined: "Declined",
  lost: "Lost",
};

/** Where the deal is on its journey from lead to closed, as a row of steps. */
export function StageJourney({ d }: { d: Deal }) {
  const off = d.stage === "declined" || d.stage === "lost";
  const at = ROAD.indexOf(off ? (d.prev_stage ?? "submitted") : d.stage);
  return (
    <ol className={`journey${off ? " off" : ""}`} aria-label={`Stage ${at + 1} of ${ROAD.length}: ${STAGE[d.stage].name}`}>
      {ROAD.map((s, i) => {
        const state = i < at ? "done" : i === at ? (off ? "stop" : "now") : "next";
        return (
          <li key={s} className={state} style={{ ["--c" as string]: `var(${STAGE[s].color})` }} aria-current={state === "now" ? "step" : undefined}>
            <span className="j-dot">{state === "done" ? I.check : state === "stop" ? I.close : null}</span>
            <span className="j-l">{state === "stop" ? SHORT[d.stage] : SHORT[s]}</span>
          </li>
        );
      })}
    </ol>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** The navy banner at the top of Deals: hello, what needs you, and the money in play. */
export function TodayHero() {
  const { me, deals } = usePortal();
  const open = deals.filter(isOpen);
  const mine = open.filter((d) => yourMove(d.stage, me.role));
  const late = mine.filter(isLate).length;
  const approved = open.filter((d) => d.stage === "approved" || d.stage === "car");
  const inPlay = approved.reduce((t, d) => t + (dealAmount(d) ?? 0), 0);
  const first = me.name.split(" ")[0];
  // Chosen in the browser: the server runs on a different clock and time zone.
  const [hi, setHi] = useState("Hello");
  useEffect(() => setHi(greeting()), []);

  return (
    <section className="hero" aria-label="Today">
      <div className="hero-t">
        <span className="hero-hi">
          {hi}, {first}
        </span>
        <h2>
          {mine.length ? (
            <>
              <CountUp text={String(mine.length)} /> deal{mine.length === 1 ? "" : "s"} need{mine.length === 1 ? "s" : ""} your move
            </>
          ) : (
            "You’re all caught up"
          )}
        </h2>
        <span className="hero-s">
          {late ? (
            <span className="hero-late">
              {I.alert}
              {late} running late
            </span>
          ) : mine.length ? (
            "Nothing late. Nice."
          ) : (
            "New moves show up here as soon as they land."
          )}
        </span>
      </div>
      <div className="hero-money">
        <small>Approved, ready to close</small>
        <b className="tnum">{inPlay ? <CountUp text={moneyShort(inPlay)} /> : "$0"}</b>
        <span>
          {approved.length} deal{approved.length === 1 ? "" : "s"} · {open.length} open in total
        </span>
      </div>
      <svg className="hero-art" viewBox="0 0 240 90" aria-hidden>
        <path d="M8 66c14-2 22-14 40-20l34-10c10-12 26-20 46-20 22 0 36 8 50 22l30 6c12 2 22 10 24 22" />
        <circle cx="62" cy="68" r="12" />
        <circle cx="176" cy="68" r="12" />
        <path d="M82 36h96" />
      </svg>
    </section>
  );
}

/** Line-art car on a road, for empty screens. An optional badge sits on the roof (inbox, chat, check…). */
export function CarArt({ badge, label }: { badge?: React.ReactNode; label?: string }) {
  return (
    <span className="carart" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg viewBox="0 0 220 110">
        <path className="ca-road" d="M10 96h200" />
        <path className="ca-road dash" d="M40 104h28M96 104h28M152 104h28" />
        <path
          className="ca-body"
          d="M28 80c0-8 5-13 13-15l26-6 22-19c6-5 13-8 21-8h30c9 0 16 3 22 9l17 18 15 3c8 2 13 8 13 16v6c0 3-2 5-5 5h-11M62 89H33c-3 0-5-2-5-5v-4M90 89h52"
        />
        <path className="ca-win" d="M95 58l16-15c3-3 7-4 11-4h12v19zM144 58V39h4c4 0 8 2 11 5l14 14z" />
        <circle className="ca-wheel" cx="76" cy="89" r="13" />
        <circle className="ca-wheel" cx="76" cy="89" r="4" />
        <circle className="ca-wheel" cx="157" cy="89" r="13" />
        <circle className="ca-wheel" cx="157" cy="89" r="4" />
        <path className="ca-light" d="M186 72h8" />
      </svg>
      {badge && <span className="ca-badge">{badge}</span>}
    </span>
  );
}

/** "Deal closed!" or "Approved!" card that rises from the bottom with the confetti, then leaves by itself. */
export function WinCard() {
  const { win, clearWin, deals, person } = usePortal();
  const [shown, setShown] = useState(win);

  useEffect(() => {
    if (!win) return;
    setShown(win);
    const t = setTimeout(clearWin, 6500);
    return () => clearTimeout(t);
  }, [win, clearWin]);

  if (!win || !shown) return null;
  const d = shown.dealId ? deals.find((x) => x.id === shown.dealId) : undefined;
  const who = person(shown.agentId)?.name ?? "Someone";
  const closed = shown.kind === "closed";
  const amount = d ? dealAmount(d) : null;
  const car = d && [d.vehicle_year, d.vehicle_make, d.vehicle_model].filter(Boolean).join(" ");

  return (
    <div className={`win ${shown.kind}`} role="status" aria-live="polite" key={shown.at}>
      <span className="win-ic">{closed ? I.trophy : I.check}</span>
      <div className="win-t">
        <small>{closed ? "Deal closed" : "Approved by a lender"}</small>
        <b>{d ? `${d.first_name} ${d.last_name}` : `${who}’s deal`}</b>
        <span>
          {[car, amount ? moneyShort(amount) : ""].filter(Boolean).join(" · ") || (closed ? "Keys in hand." : "On to car selection.")}
          {" · "}
          {closed ? `Nice work, ${who}!` : `${who}’s customer`}
        </span>
      </div>
      <button className="iconbtn" onClick={clearWin} aria-label="Close">
        {I.close}
      </button>
    </div>
  );
}
