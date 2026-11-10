"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePortal } from "./PortalProvider";
import { Avatar, Chip, I, Mentionized } from "./ui";
import { useIsMobile } from "./Shell";
import { supabase, errText } from "@/lib/supabase/client";
import { useFocusTrap } from "@/lib/useFocusTrap";
import {
  CONDITION_PRESETS,
  FREQ,
  STAGE,
  calcPayment,
  canSee,
  daysSince,
  fullName,
  money,
  money2,
  parseMoney,
  targets,
  vehicleLine,
  waitingText,
  when,
} from "@/lib/stages";
import type { Condition, Deal, DealEvent, LenderSubmission, Message, PaymentFreq, Profile } from "@/lib/types";

const numStr = (n: number | string | null) => (n == null ? null : String(n));
const num = (n: number | string | null) => (n == null || n === "" ? null : Number(n));

export function DealPanel({ id }: { id: number | null }) {
  const { deals, dealsLoaded, closeDeal } = usePortal();
  const deal = id ? deals.find((d) => d.id === id) : undefined;
  const ref = useRef<HTMLElement>(null);
  useFocusTrap(ref, !!id);
  return (
    <aside
      ref={ref}
      className={`panel${id ? " on" : ""}`}
      role="dialog"
      aria-modal={id ? true : undefined}
      aria-label={deal ? fullName(deal) : "Deal"}
      aria-hidden={!id}
      tabIndex={-1}
    >
      {id && deal && <DealView key={deal.id} d={deal} />}
      {id && !deal && (
        <div className="p-head">
          <div className="p-row">
            <div style={{ flex: 1 }}>
              {dealsLoaded ? (
                <>
                  <h2>Deal not available</h2>
                  <p style={{ color: "var(--fg-2)" }}>It may have been reassigned to someone else.</p>
                </>
              ) : (
                <div className="skel" style={{ height: 48 }} />
              )}
            </div>
            <button className="iconbtn" onClick={closeDeal} aria-label="Close">
              {I.close}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function DealView({ d }: { d: Deal }) {
  const p = usePortal();
  const { me, person, profiles, closeDeal, tryMove, setDialog, toast, refreshDeals, refreshNotifications } = p;
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<"details" | "chat">("details");
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<DealEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Messages + history for this deal, kept live.
  useEffect(() => {
    const sb = supabase();
    let alive = true;
    (async () => {
      const [m, e] = await Promise.all([
        sb.from("messages").select("*").eq("deal_id", d.id).order("created_at"),
        sb.from("deal_events").select("*").eq("deal_id", d.id).order("created_at", { ascending: false }),
      ]);
      if (!alive) return;
      setMessages((m.data ?? []) as Message[]);
      setEvents((e.data ?? []) as DealEvent[]);
      setLoaded(true);
    })();
    // Opening a deal marks its notifications read.
    sb.from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("deal_id", d.id)
      .is("read_at", null)
      .then(() => refreshNotifications());
    const ch = sb
      .channel(`deal-${d.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `deal_id=eq.${d.id}` }, (x) => {
        const m = x.new as Message;
        setMessages((list) => (list.some((y) => y.id === m.id) ? list : [...list, m]));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "deal_events", filter: `deal_id=eq.${d.id}` }, (x) => {
        const ev = x.new as DealEvent;
        setEvents((list) => (list.some((y) => y.id === ev.id) ? list : [ev, ...list]));
      })
      .subscribe();
    return () => {
      alive = false;
      sb.removeChannel(ch);
    };
  }, [d.id, refreshNotifications]);

  const ts = targets(d, me);
  const lead = me.role === "admin" || me.role === "lead";
  const canReassign = lead && d.stage !== "closed" && d.stage !== "declined";
  const lendersEditable = lead && (d.stage === "submitted" || d.stage === "approved");
  const showLenders = d.lender_submissions.length > 0 || (me.role === "admin" && ["submitted", "approved"].includes(d.stage));
  const showVehicle =
    ["approved", "car", "closed"].includes(d.stage) || !!(d.vehicle_desc || d.vehicle_make || d.vehicle_model || d.vehicle_year || d.vin);
  const showConditions = (d.deal_conditions ?? []).length > 0 || ["submitted", "approved", "car"].includes(d.stage);
  const editable = !(me.role === "agent" && (d.stage === "closed" || d.stage === "declined"));
  const chatCount = messages.filter((m) => m.kind === "user").length;
  const days = daysSince(d.stage_changed_at);

  const save = useCallback(
    async (patch: Partial<Deal>) => {
      const { error } = await supabase().from("deals").update(patch).eq("id", d.id);
      if (error) toast(errText(error), "warn");
      else refreshDeals();
    },
    [d.id, refreshDeals, toast],
  );
  const saveInt = (key: "vehicle_year" | "vehicle_km", v: string) => {
    const digits = v.replace(/[^\d]/g, "");
    if (v.trim() && !digits) return toast("Enter a number.", "warn");
    save({ [key]: digits ? parseInt(digits, 10) : null });
  };

  return (
    <>
      <div className="p-head">
        <div className="p-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="p-meta">
              <Chip stage={d.stage} />
              <span className="who">
                <Avatar p={person(d.agent_id)} size="sm" />
                {person(d.agent_id)?.name ?? "Unassigned"}’s deal
              </span>
              <span>· {days === 0 ? "Moved today" : `${days} day${days === 1 ? "" : "s"} in stage`}</span>
            </div>
            <h2>{fullName(d)}</h2>
          </div>
          <button className="iconbtn" onClick={closeDeal} aria-label="Close">
            {I.close}
          </button>
        </div>
        <div className="p-actions">
          {ts.length ? (
            ts.map((t) => (
              <button key={t.to} className={`btn${t.primary ? " primary" : ""}${t.danger ? " danger" : ""}`} onClick={() => tryMove(d, t.to)}>
                {t.label ?? `Move to ${STAGE[t.to].name}`}
              </button>
            ))
          ) : (
            <span className="wait">
              {I.hourglass}
              {waitingText(d)}
            </span>
          )}
        </div>
        <div className="p-tabs">
          <button aria-pressed={tab === "details"} onClick={() => setTab("details")}>
            Details
          </button>
          <button aria-pressed={tab === "chat"} onClick={() => setTab("chat")}>
            Chat{chatCount ? ` · ${chatCount}` : ""}
          </button>
        </div>
      </div>

      <div className="p-body" data-tab={isMobile ? tab : "both"}>
        <section className="p-details">
          <div className="sec">
            <h4>Customer</h4>
            <dl className="kv">
              <dt>First name</dt>
              <dd><Field value={d.first_name} disabled={!editable} required onSave={(v) => save({ first_name: v })} /></dd>
              <dt>Last name</dt>
              <dd><Field value={d.last_name} disabled={!editable} required onSave={(v) => save({ last_name: v })} /></dd>
              <dt>Phone</dt>
              <dd><Field value={d.phone} type="tel" className="tnum" placeholder="Add phone" disabled={!editable} onSave={(v) => save({ phone: v || null })} /></dd>
              <dt>Email</dt>
              <dd><Field value={d.email} type="email" placeholder="Add email" disabled={!editable} onSave={(v) => save({ email: v || null })} /></dd>
              <dt>City</dt>
              <dd><Field value={d.city} placeholder="Add city" disabled={!editable} onSave={(v) => save({ city: v || null })} /></dd>
              <dt>Agent</dt>
              <dd>
                {canReassign ? (
                  <span className="inl">
                    <Avatar p={person(d.agent_id)} size="sm" />
                    <select
                      aria-label="Reassign deal"
                      value={d.agent_id}
                      onChange={async (e) => {
                        const to = e.target.value;
                        const { error } = await supabase().rpc("reassign_deal", { p_deal: d.id, p_agent: to });
                        if (error) return toast(errText(error), "warn");
                        toast(`Reassigned to ${person(to)?.name}`, "ok");
                        refreshDeals();
                      }}
                    >
                      {profiles.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </span>
                ) : (
                  <span className="who">
                    <Avatar p={person(d.agent_id)} size="sm" />
                    {person(d.agent_id)?.name}
                  </span>
                )}
              </dd>
            </dl>
          </div>

          <div className="sec">
            <h4>
              Driver’s licence<span className="r">Optional</span>
            </h4>
            <div className="lic">
              <LicenceSlot d={d} side="front" canUpload={editable} />
              <LicenceSlot d={d} side="back" canUpload={editable} />
            </div>
            <div className="priv">{I.lock}Private. Every view is logged.</div>
          </div>

          <div className="sec">
            <h4>Application</h4>
            <dl className="kv">
              <dt>Dealertrack #</dt>
              <dd><Field value={d.dealertrack_no} className="mono" placeholder="Not filled yet" disabled={!editable} onSave={(v) => save({ dealertrack_no: v || null })} /></dd>
              <dt>Down payment</dt>
              <dd><MoneyField value={d.down_payment} label="Down payment" disabled={!editable} onSave={(n) => save({ down_payment: n })} /></dd>
              <dt>Trade-in</dt>
              <dd><Field value={d.trade_in_desc} placeholder="e.g. 2014 Honda Civic, 160,000 km" label="Trade-in" disabled={!editable} onSave={(v) => save({ trade_in_desc: v || null })} /></dd>
              {(d.trade_in_desc || d.trade_in_value != null) && (
                <>
                  <dt>Trade-in value</dt>
                  <dd><MoneyField value={d.trade_in_value} label="Trade-in value" disabled={!editable} onSave={(n) => save({ trade_in_value: n })} /></dd>
                </>
              )}
              <dt>Notes for TJ</dt>
              <dd><Field value={d.notes} multiline placeholder="Job, income, what they want…" disabled={!editable} onSave={(v) => save({ notes: v || null })} /></dd>
            </dl>
          </div>

          {showLenders && (
            <div className="sec">
              <h4>
                Lenders
                <span className="r">
                  {d.lender_submissions.filter((l) => l.status === "approved").length} approved of {d.lender_submissions.length}
                </span>
              </h4>
              <div className="lenders">
                {d.lender_submissions.map((l) => (
                  <LenderRow key={l.id} l={l} editable={lendersEditable} />
                ))}
                {me.role === "admin" && ["submitted", "approved"].includes(d.stage) && (
                  <div className="addl">
                    <button className="btn" onClick={() => setDialog({ kind: "lenders", deal: d })}>
                      {I.plus}Add lenders
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {showConditions && <Conditions d={d} />}

          {showVehicle && (
            <div className="sec">
              <h4>
                Vehicle{vehicleLine(d) && <span className="r">{vehicleLine(d)}</span>}
              </h4>
              <dl className="kv">
                <dt>Year</dt>
                <dd><Field value={numStr(d.vehicle_year)} className="tnum" inputMode="numeric" placeholder="e.g. 2022" label="Year" disabled={!editable} onSave={(v) => saveInt("vehicle_year", v)} /></dd>
                <dt>Make</dt>
                <dd><Field value={d.vehicle_make} placeholder="e.g. Toyota" label="Make" disabled={!editable} onSave={(v) => save({ vehicle_make: v || null })} /></dd>
                <dt>Model</dt>
                <dd><Field value={d.vehicle_model} placeholder="e.g. RAV4" label="Model" disabled={!editable} onSave={(v) => save({ vehicle_model: v || null })} /></dd>
                <dt>Trim</dt>
                <dd><Field value={d.vehicle_trim} placeholder="e.g. LE AWD" label="Trim" disabled={!editable} onSave={(v) => save({ vehicle_trim: v || null })} /></dd>
                <dt>Kilometres</dt>
                <dd>
                  <Field
                    value={numStr(d.vehicle_km)}
                    className="tnum"
                    inputMode="numeric"
                    placeholder="e.g. 45,000"
                    label="Kilometres"
                    disabled={!editable}
                    format={(v) => (v ? `${Number(v).toLocaleString("en-CA")} km` : "")}
                    onSave={(v) => saveInt("vehicle_km", v)}
                  />
                </dd>
                <dt>VIN</dt>
                <dd>
                  <Field
                    value={d.vin}
                    className="mono"
                    placeholder="17 characters"
                    label="VIN"
                    disabled={!editable}
                    onSave={(v) => {
                      const vin = v.toUpperCase().replace(/[\s-]/g, "");
                      if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))
                        return toast(`That VIN has ${vin.length} characters. A VIN is 17 letters and numbers, with no I, O or Q.`, "warn");
                      save({ vin: vin || null });
                    }}
                  />
                </dd>
                <dt>Price</dt>
                <dd><MoneyField value={d.vehicle_price} label="Vehicle price" disabled={!lead} onSave={(n) => save({ vehicle_price: n })} /></dd>
                <dt>Dealer</dt>
                <dd><Field value={d.dealer} placeholder="Dealership" disabled={!lead} onSave={(v) => save({ dealer: v || null })} /></dd>
                {d.vehicle_desc && (
                  <>
                    <dt>Earlier note</dt>
                    <dd><Field value={d.vehicle_desc} label="Earlier vehicle note" disabled={!editable} onSave={(v) => save({ vehicle_desc: v || null })} /></dd>
                  </>
                )}
              </dl>
            </div>
          )}

          {d.stage === "lost" && (
            <div className="sec">
              <h4>Lost reason</h4>
              <p style={{ margin: 0 }}>
                {d.lost_reason}. Reopening returns it to {d.prev_stage ? STAGE[d.prev_stage].name : "its last stage"}.
              </p>
            </div>
          )}

          <div className="sec">
            <h4>History</h4>
            <div className="hist">
              {events.map((e) => (
                <div key={e.id}>
                  {e.body}
                  <small>{when(e.created_at)}</small>
                </div>
              ))}
              {!events.length && loaded && <div>No history yet</div>}
            </div>
          </div>
        </section>

        <Chat d={d} messages={messages} loaded={loaded} />
      </div>
    </>
  );
}

function Field(props: {
  value: string | null;
  onSave: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  multiline?: boolean;
  className?: string;
  type?: string;
  inputMode?: "decimal" | "numeric" | "text";
  format?: (v: string) => string;
  /** Accessible name when the placeholder isn't a good one. */
  label?: string;
}) {
  const { value, onSave, disabled, required, multiline, className = "", format } = props;
  const [v, setV] = useState(value ?? "");
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setV(value ?? "");
  }, [value, focused]);
  if (disabled) {
    const shown = format ? format(value ?? "") : value;
    return shown ? <span className={className} style={{ whiteSpace: "pre-wrap" }}>{shown}</span> : <span style={{ color: "var(--fg-3)" }}>—</span>;
  }
  const commit = () => {
    setFocused(false);
    const t = v.trim();
    if (required && !t) return setV(value ?? "");
    if (t !== (value ?? "")) onSave(t);
  };
  const common = {
    className: `edit ${className}`,
    value: focused || !format ? v : format(v),
    placeholder: props.placeholder,
    onFocus: () => setFocused(true),
    onBlur: commit,
    "aria-label": props.label ?? props.placeholder,
  };
  return multiline ? (
    <textarea {...common} rows={Math.min(6, Math.max(2, v.split("\n").length))} onChange={(e) => setV(e.target.value)} />
  ) : (
    <input
      {...common}
      type={props.type ?? "text"}
      inputMode={props.inputMode}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setV(value ?? "");
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/** A dollar field: shows "$28,500", accepts "28500", "$28,500" or "28.5k". */
function MoneyField(props: { value: number | string | null; onSave: (n: number | null) => void; label: string; disabled?: boolean; cents?: boolean }) {
  const { toast } = usePortal();
  return (
    <Field
      value={numStr(props.value)}
      className="tnum"
      inputMode="decimal"
      placeholder="$0"
      label={props.label}
      disabled={props.disabled}
      format={(v) => (v ? (props.cents ? money2(Number(v)) : money(Number(v))) : "")}
      onSave={(v) => {
        const n = parseMoney(v);
        if (Number.isNaN(n)) return toast(`“${v}” isn’t an amount. Try 28500 or 28.5k.`, "warn");
        props.onSave(n);
      }}
    />
  );
}

/** One lender on a deal: its decision, and once approved, what they offered. */
function LenderRow({ l, editable }: { l: LenderSubmission; editable: boolean }) {
  const { toast, refreshDeals } = usePortal();
  const showTerms = l.status === "approved" || l.amount != null || !!l.terms;
  const freq: PaymentFreq = l.payment_freq ?? "monthly";

  async function setStatus(status: string) {
    const { error } = await supabase().rpc("set_lender_status", { p_submission: l.id, p_status: status, p_terms: null });
    if (error) return toast(errText(error), "warn");
    refreshDeals();
  }

  async function saveTerms(patch: Partial<LenderSubmission>) {
    const next = { ...l, ...patch };
    // Keep the payment in step with amount, rate and term, unless someone typed the lender's own number.
    if (!("payment" in patch)) {
      const before = calcPayment(num(l.amount), num(l.rate), l.term_months, l.payment_freq);
      const typed = l.payment != null && (before == null || Math.abs(Number(l.payment) - before) >= 0.01);
      if (!typed) next.payment = calcPayment(num(next.amount), num(next.rate), next.term_months, next.payment_freq);
    }
    const { error } = await supabase().rpc("set_lender_terms", {
      p_submission: l.id,
      p_amount: num(next.amount),
      p_rate: num(next.rate),
      p_term: next.term_months,
      p_payment: num(next.payment),
      p_freq: next.payment_freq ?? "monthly",
      p_notes: next.terms ?? null,
    });
    if (error) return toast(errText(error), "warn");
    refreshDeals();
  }

  return (
    <div className="lrow">
      <span className="nm">
        {l.lender}{" "}
        <span style={{ color: "var(--fg-3)", fontWeight: 400, fontSize: 12.5 }}>
          · {new Date(l.submitted_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
        </span>
      </span>
      {editable ? (
        <select aria-label={`Decision from ${l.lender}`} value={l.status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="declined">Declined</option>
        </select>
      ) : (
        <span className={`pill ${l.status}`}>{l.status[0].toUpperCase() + l.status.slice(1)}</span>
      )}
      {showTerms && (
        <div className="terms">
          <div className="tf">
            <span className="tl">Amount</span>
            <MoneyField value={l.amount} label={`${l.lender} approved amount`} disabled={!editable} onSave={(n) => saveTerms({ amount: n })} />
          </div>
          <div className="tf">
            <span className="tl">Rate</span>
            <Field
              value={numStr(l.rate)}
              className="tnum"
              inputMode="decimal"
              placeholder="0.00%"
              label={`${l.lender} rate`}
              disabled={!editable}
              format={(v) => (v ? `${Number(v)}%` : "")}
              onSave={(v) => {
                const t = v.replace(/[%\s]/g, "");
                const n = Number(t);
                if (t && !Number.isFinite(n)) return toast("Enter a rate like 8.99.", "warn");
                saveTerms({ rate: t ? n : null });
              }}
            />
          </div>
          <div className="tf">
            <span className="tl">Term</span>
            <Field
              value={numStr(l.term_months)}
              className="tnum"
              inputMode="numeric"
              placeholder="84 mo"
              label={`${l.lender} term in months`}
              disabled={!editable}
              format={(v) => (v ? `${v} mo` : "")}
              onSave={(v) => {
                const digits = v.replace(/[^\d]/g, "");
                if (v.trim() && !digits) return toast("Enter the term in months, like 84.", "warn");
                saveTerms({ term_months: digits ? parseInt(digits, 10) : null });
              }}
            />
          </div>
          <div className="tf">
            <span className="tl">Payment</span>
            <span className="pay">
              <MoneyField cents value={l.payment} label={`${l.lender} payment`} disabled={!editable} onSave={(n) => saveTerms({ payment: n })} />
              {editable ? (
                <select aria-label={`${l.lender} payment frequency`} value={freq} onChange={(e) => saveTerms({ payment_freq: e.target.value as PaymentFreq })}>
                  {Object.entries(FREQ).map(([k, f]) => (
                    <option key={k} value={k}>
                      {f.label}
                    </option>
                  ))}
                </select>
              ) : (
                l.payment != null && <span className="freq">{FREQ[freq].label.toLowerCase()}</span>
              )}
            </span>
          </div>
          <div className="tf wide">
            <span className="tl">Notes</span>
            <Field value={l.terms} placeholder="Anything else the lender said" label={`${l.lender} notes`} disabled={!editable} onSave={(v) => saveTerms({ terms: v || null })} />
          </div>
        </div>
      )}
    </div>
  );
}

/** What the lender needs before funding. Anyone on the deal ticks items off; each tick records who and when. */
function Conditions({ d }: { d: Deal }) {
  const { me, person, toast, refreshDeals } = usePortal();
  const [text, setText] = useState("");
  const list = [...(d.deal_conditions ?? [])].sort((a, b) => a.id - b.id);
  const done = list.filter((c) => c.done_at).length;
  const open = !["closed", "declined", "lost"].includes(d.stage);
  const lead = me.role === "admin" || me.role === "lead";
  const presets = CONDITION_PRESETS.filter((p) => !list.some((c) => c.label.toLowerCase() === p.toLowerCase()));

  async function add(label: string) {
    const t = label.trim();
    if (!t) return;
    const { error } = await supabase().from("deal_conditions").insert({ deal_id: d.id, label: t });
    if (error) return toast(errText(error), "warn");
    refreshDeals();
  }
  async function toggle(c: Condition) {
    const { error } = await supabase().rpc("toggle_condition", { p_id: c.id, p_done: !c.done_at });
    if (error) return toast(errText(error), "warn");
    refreshDeals();
  }
  async function remove(c: Condition) {
    const { error } = await supabase().from("deal_conditions").delete().eq("id", c.id);
    if (error) return toast(errText(error), "warn");
    refreshDeals();
  }

  return (
    <div className="sec">
      <h4>
        Conditions
        {list.length > 0 && (
          <span className="r">
            {done} of {list.length} received
          </span>
        )}
      </h4>
      <div className="conds">
        {list.map((c) => (
          <div key={c.id} className={`cond${c.done_at ? " done" : ""}`}>
            <label>
              <input type="checkbox" checked={!!c.done_at} disabled={!open} onChange={() => toggle(c)} />
              <span className="cl">{c.label}</span>
            </label>
            {c.done_at && (
              <small>
                {person(c.done_by)?.name ?? "Someone"} · {when(c.done_at)}
              </small>
            )}
            {open && (lead || (c.created_by === me.id && !c.done_at)) && (
              <button className="iconbtn rm" aria-label={`Remove ${c.label}`} onClick={() => remove(c)}>
                {I.close}
              </button>
            )}
          </div>
        ))}
        {!list.length && <div className="cond-empty">Nothing yet. Add what the lender asked for before funding.</div>}
        {open && (
          <div className="cond-add">
            {presets.length > 0 && (
              <div className="presets">
                {presets.map((p) => (
                  <button key={p} type="button" className="preset" onClick={() => add(p)}>
                    {I.plus}
                    {p}
                  </button>
                ))}
              </div>
            )}
            <form
              className="addrow"
              onSubmit={(e) => {
                e.preventDefault();
                add(text);
                setText("");
              }}
            >
              <input className="input" value={text} maxLength={120} placeholder="Other condition, e.g. Bank statements" aria-label="New condition" onChange={(e) => setText(e.target.value)} />
              <button className="btn" disabled={!text.trim()}>
                Add
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function LicenceSlot({ d, side, canUpload }: { d: Deal; side: "front" | "back"; canUpload: boolean }) {
  const { toast, refreshDeals, move } = usePortal();
  const path = side === "front" ? d.licence_front : d.licence_back;
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = side === "front" ? "Front" : "Back";
  const isPdf = !!path && path.toLowerCase().endsWith(".pdf");

  useEffect(() => {
    if (!path) return setUrl(null);
    let alive = true;
    (async () => {
      const sb = supabase();
      const { data, error } = await sb.storage.from("licences").createSignedUrl(path, 300);
      if (!alive) return;
      if (error) return setUrl(null);
      setUrl(data.signedUrl);
      await sb.rpc("log_licence_view", { p_deal: d.id, p_side: side });
    })();
    return () => {
      alive = false;
    };
  }, [path, d.id, side]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const key = `${d.id}/${side}-${Date.now()}.${ext}`;
    const sb = supabase();
    const up = await sb.storage.from("licences").upload(key, file, { contentType: file.type || undefined });
    if (up.error) {
      setBusy(false);
      return toast(errText(up.error), "warn");
    }
    const { error } = await sb.from("deals").update(side === "front" ? { licence_front: key } : { licence_back: key }).eq("id", d.id);
    setBusy(false);
    if (error) return toast(errText(error), "warn");
    toast("Licence saved privately", "ok");
    const other = side === "front" ? d.licence_back : d.licence_front;
    if (d.stage === "new" && other) await move(d, "docs");
    else refreshDeals();
  }

  const input = canUpload && (
    <input type="file" accept="image/*,application/pdf" capture="environment" aria-label={`${path ? "Replace" : "Add"} licence ${side}`} onChange={(e) => upload(e.target.files?.[0])} />
  );

  if (!path)
    return (
      <label className="licard blank">
        <span>
          {I.camera}
          <br />
          {canUpload ? `Add ${side}` : `No ${side}`}
        </span>
        {input}
        {busy && <span className="busy">Uploading…</span>}
      </label>
    );

  return (
    <div className="licard">
      {url && !isPdf && (
        <a href={url} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`Licence ${side}`} />
        </a>
      )}
      {url && isPdf && (
        <a className="pdf" href={url} target="_blank" rel="noreferrer">
          Open PDF
        </a>
      )}
      {!url && <div className="skel" style={{ position: "absolute", inset: 0 }} />}
      <span className="tag">{label}</span>
      {busy && <span className="busy">Uploading…</span>}
    </div>
  );
}

function Chat({ d, messages, loaded }: { d: Deal; messages: Message[]; loaded: boolean }) {
  const { me, profiles, person, toast } = usePortal();
  const [text, setText] = useState("");
  const [pop, setPop] = useState<{ q: string; sel: number } | null>(null);
  const [sending, setSending] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const names = profiles.map((p) => p.name);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages.length]);

  const options = pop ? profiles.filter((p) => p.id !== me.id && p.name.toLowerCase().startsWith(pop.q.toLowerCase())) : [];

  function onInput(v: string) {
    setText(v);
    const el = ta.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 120) + "px";
    }
    const m = v.slice(0, el?.selectionStart ?? v.length).match(/@(\w*)$/);
    setPop(m ? { q: m[1], sel: 0 } : null);
  }

  function insert(p: Profile) {
    const el = ta.current!;
    const pos = el.selectionStart;
    const before = text.slice(0, pos).replace(/@(\w*)$/, `@${p.name} `);
    const next = before + text.slice(pos);
    setText(next);
    setPop(null);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = before.length;
    });
  }

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const { error } = await supabase().from("messages").insert({ deal_id: d.id, body });
    setSending(false);
    if (error) return toast(errText(error), "warn");
    setText("");
    if (ta.current) ta.current.style.height = "auto";
    const tagged = profiles.filter((p) => p.id !== me.id && new RegExp(`@${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "i").test(body));
    const blocked = tagged.filter((p) => !canSee(p, d));
    const ok = tagged.filter((p) => canSee(p, d));
    if (blocked.length)
      toast(`${blocked.map((p) => p.name).join(", ")} can’t see ${person(d.agent_id)?.name}’s deals, so they weren’t notified`, "warn");
    else if (ok.length) toast(`Sent · ${ok.map((p) => p.name).join(", ")} notified`, "ok");
  }

  return (
    <section className="p-chat">
      <div className="chat-h">Conversation</div>
      <div className="msgs" ref={list}>
        {!loaded && <div className="skel" style={{ height: 60 }} />}
        {loaded && !messages.length && (
          <div className="emptystate" style={{ padding: "32px 8px" }}>
            <h3>No messages yet</h3>Talk about {d.first_name}’s deal here. Type @ to tag someone.
          </div>
        )}
        {messages.map((m) =>
          m.kind === "system" ? (
            <div key={m.id} className="sys">
              {m.body} · {when(m.created_at)}
            </div>
          ) : (
            <div key={m.id} className={`msg${m.author_id === me.id ? " me" : ""}`}>
              <Avatar p={person(m.author_id)} />
              <div className="b">
                <div className="h">
                  <b>{person(m.author_id)?.name ?? "Former team member"}</b>
                  <small>{when(m.created_at)}</small>
                </div>
                <div className="x">
                  <Mentionized text={m.body} names={names} />
                </div>
              </div>
            </div>
          ),
        )}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {pop && options.length > 0 && (
          <div className="mpop" role="listbox">
            {options.map((p, i) => (
              <button type="button" key={p.id} className={i === pop.sel ? "sel" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(p)}>
                <Avatar p={p} size="sm" />
                {p.name}
                <small>{canSee(p, d) ? { admin: "Admin", lead: "Team lead", agent: "Agent" }[p.role] : "Can’t see this deal"}</small>
              </button>
            ))}
          </div>
        )}
        <div className="box">
          <textarea
            ref={ta}
            id="composer-text"
            rows={1}
            value={text}
            placeholder={`Message about ${d.first_name}… type @ to tag`}
            aria-label="Message"
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              if (pop && options.length) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  return setPop({ ...pop, sel: Math.min(pop.sel + 1, options.length - 1) });
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  return setPop({ ...pop, sel: Math.max(pop.sel - 1, 0) });
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  return insert(options[pop.sel]);
                }
                if (e.key === "Escape") {
                  e.stopPropagation();
                  return setPop(null);
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="btn primary" aria-label="Send" style={{ padding: "7px 9px" }} disabled={sending || !text.trim()}>
            {I.send}
          </button>
        </div>
        <div className="tip">Enter to send · Shift+Enter for a new line</div>
      </form>
    </section>
  );
}
