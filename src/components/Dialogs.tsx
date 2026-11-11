"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isOpen, usePortal } from "./PortalProvider";
import { Avatar, Chip, I } from "./ui";
import { supabase, errText } from "@/lib/supabase/client";
import { fullName, yourMove } from "@/lib/stages";
import { useFocusTrap } from "@/lib/useFocusTrap";
import type { Deal } from "@/lib/types";

export function Dialogs() {
  const { dialog } = usePortal();
  return dialog ? <Overlay /> : null;
}

function Overlay() {
  const { dialog, setDialog } = usePortal();
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true);
  if (!dialog) return null;
  const close = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setDialog(null);
  };
  return (
    <div className="overlay" ref={ref} onClick={close}>
      {dialog.kind === "lost" && <LostDialog deal={dialog.deal} />}
      {dialog.kind === "lenders" && <LendersDialog deal={dialog.deal} />}
      {dialog.kind === "idea" && <IdeaDialog />}
      {dialog.kind === "palette" && <Palette />}
    </div>
  );
}

function LostDialog({ deal }: { deal: Deal }) {
  const { lostReasons, setDialog, move } = usePortal();
  const reasons = lostReasons.filter((r) => r.active);
  const [reason, setReason] = useState(reasons[0]?.name ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="dlg"
      role="dialog"
      aria-modal="true"
      aria-label="Mark lost"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        if (await move(deal, "lost", reason)) setDialog(null);
        setBusy(false);
      }}
    >
      <h3>Mark {fullName(deal)} as lost</h3>
      <p>Pick a reason. It shows up in the reports, and the deal can be reopened later.</p>
      <div className="opts">
        {reasons.map((r) => (
          <label key={r.id} className="opt">
            <input type="radio" name="reason" value={r.name} checked={reason === r.name} onChange={() => setReason(r.name)} />
            {r.name}
          </label>
        ))}
      </div>
      <div className="formfoot">
        <button type="button" className="btn" onClick={() => setDialog(null)}>
          Cancel
        </button>
        <button className="btn primary" style={{ background: "var(--bad)", borderColor: "var(--bad)", color: "#fff" }} disabled={busy || !reason}>
          Mark lost
        </button>
      </div>
    </form>
  );
}

function LendersDialog({ deal }: { deal: Deal }) {
  const { lenders, setDialog, toast, refreshDeals } = usePortal();
  const already = new Set(deal.lender_submissions.map((l) => l.lender));
  const options = lenders.filter((l) => l.active && !already.has(l.name));
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const toggle = (n: string) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));
  return (
    <form
      className="dlg"
      role="dialog"
      aria-modal="true"
      aria-label="Submit to lenders"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const { error } = await supabase().rpc("add_lenders", { p_deal: deal.id, p_lenders: picked });
        setBusy(false);
        if (error) return toast(errText(error), "warn");
        toast(`Submitted to ${picked.join(", ")}`, "ok");
        setDialog(null);
        refreshDeals();
      }}
    >
      <h3>{deal.stage === "ready" ? "Submit to lenders" : "Add lenders"}</h3>
      <p>Pick every lender you sent {deal.first_name}’s application to. You can add more later.</p>
      <div className="opts">
        {options.map((l) => (
          <label key={l.id} className="opt">
            <input type="checkbox" checked={picked.includes(l.name)} onChange={() => toggle(l.name)} />
            {l.name}
          </label>
        ))}
        {!options.length && <p>Every lender on the list is already on this deal. Add new lenders in Settings.</p>}
      </div>
      <div className="formfoot">
        <button type="button" className="btn" onClick={() => setDialog(null)}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy || !picked.length}>
          {deal.stage === "ready" ? `Submit to ${picked.length || ""} lender${picked.length === 1 ? "" : "s"}` : "Add"}
        </button>
      </div>
    </form>
  );
}

function IdeaDialog() {
  const { setDialog, toast } = usePortal();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="dlg"
      role="dialog"
      aria-modal="true"
      aria-label="Suggest a feature"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const { error } = await supabase().from("feature_ideas").insert({ body: text.trim() });
        setBusy(false);
        if (error) return toast(errText(error), "warn");
        toast("Idea sent to TJ", "ok");
        setDialog(null);
      }}
    >
      <h3>Suggest a feature</h3>
      <p>What would make your day easier? TJ sees every idea and picks what gets built next.</p>
      <textarea
        className="input"
        id="idea-text"
        rows={4}
        required
        minLength={3}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Show me which deals haven’t been touched in 3 days"
      />
      <div className="formfoot">
        <button type="button" className="btn" onClick={() => setDialog(null)}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy}>
          Send idea
        </button>
      </div>
    </form>
  );
}

function Palette() {
  const { deals, person, setDialog, openDeal, me, setLayout } = usePortal();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    const digits = t.replace(/\D/g, "");
    // Nothing typed: the open deals waiting on you, oldest first.
    if (!t)
      return deals
        .filter((d) => isOpen(d) && yourMove(d.stage, me.role))
        .sort((a, b) => a.stage_changed_at.localeCompare(b.stage_changed_at))
        .slice(0, 6);
    return deals
      .filter(
        (d) =>
          fullName(d).toLowerCase().includes(t) ||
          (digits.length >= 3 && (d.phone ?? "").replace(/\D/g, "").includes(digits)) ||
          (d.dealertrack_no ?? "").toLowerCase().includes(t),
      )
      .slice(0, 8);
  }, [deals, q, me.role]);
  const actions = [
    { label: "New deal", icon: I.plus, go: () => router.push("/new") },
    { label: "Check a pay stub", icon: I.stub, go: () => router.push("/paystub") },
    { label: "Go to Deals", icon: I.board, go: () => router.push("/deals") },
    { label: "Go to Chats", icon: I.team, go: () => router.push("/chats") },
    { label: "Go to Team room", icon: I.chat, go: () => router.push("/team") },
    { label: "Go to Inbox", icon: I.inbox, go: () => router.push("/inbox") },
    { label: "Show deals as a board", icon: I.board, go: () => (setLayout("board"), router.push("/deals")) },
    { label: "Show deals as a table", icon: I.board, go: () => (setLayout("table"), router.push("/deals")) },
    ...(me.role === "admin" ? [{ label: "Go to Settings", icon: I.gear, go: () => router.push("/settings") }] : []),
  ].filter((a) => !q || a.label.toLowerCase().includes(q.trim().toLowerCase()));
  const total = results.length + actions.length;

  const pick = (i: number) => {
    setDialog(null);
    if (i < results.length) openDeal(results[i].id);
    else actions[i - results.length].go();
  };

  return (
    <div className="pal" role="dialog"
      aria-modal="true" aria-label="Search">
      <div className="in">
        {I.search}
        <input
          ref={inputRef}
          id="palette-input"
          placeholder="Search by name, phone or Dealertrack #"
          aria-label="Search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, total - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter" && total) {
              e.preventDefault();
              pick(sel);
            }
          }}
        />
        <kbd className="mono" style={{ color: "var(--fg-3)" }}>
          esc
        </kbd>
      </div>
      <div className="res">
        {results.length > 0 && <div className="grp">{q.trim() ? "Customers" : "Waiting on you"}</div>}
        {results.map((d, i) => (
          <button key={d.id} className={`it${sel === i ? " sel" : ""}`} onClick={() => pick(i)}>
            <Avatar p={person(d.agent_id)} size="sm" />
            <b>{fullName(d)}</b>
            <Chip stage={d.stage} />
            <span className="s tnum">{d.phone}</span>
          </button>
        ))}
        {actions.length > 0 && <div className="grp">Actions</div>}
        {actions.map((a, j) => (
          <button key={a.label} className={`it act${sel === results.length + j ? " sel" : ""}`} onClick={() => pick(results.length + j)}>
            <span className="act-ic">{a.icon}</span>
            {a.label}
            {sel === results.length + j && <kbd className="enter">↵</kbd>}
          </button>
        ))}
        {!total && <div className="emptystate" style={{ padding: 24 }}>Nothing matches “{q}”.</div>}
      </div>
    </div>
  );
}
