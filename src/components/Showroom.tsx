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

  return (
    <section className="hero" aria-label="Today">
      <div className="hero-t">
        <span className="hero-hi">
          {greeting()}, {first}
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
