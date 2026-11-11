"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isOpen, usePortal } from "@/components/PortalProvider";
import { I } from "@/components/ui";
import { supabase, errText } from "@/lib/supabase/client";
import { SAVED_COLUMNS, cad, reportText, type Report, type SavedCheck } from "@/lib/paystub";
import { fullName, when } from "@/lib/stages";
import { PaystubReport } from "@/components/PaystubResult";

const MAX_FILES = 8;
const MAX_BYTES = 4 * 1024 * 1024; // the server's limit

/** Opens a photo for drawing. createImageBitmap first; older iPhones fall back to an <img>. */
async function decode(file: File): Promise<{ src: CanvasImageSource; w: number; h: number }> {
  try {
    const bmp = await createImageBitmap(file);
    return { src: bmp, w: bmp.width, h: bmp.height };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { src: img, w: img.naturalWidth, h: img.naturalHeight };
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

/** Phone photos are often 3–6 MB (and sometimes HEIC). Re-save them as a smaller JPEG so the upload is quick and readable. */
async function shrink(file: File): Promise<File> {
  const isImage = file.type.startsWith("image/") || /\.(jpe?g|png|webp|hei[cf])$/i.test(file.name);
  if (!isImage || file.type === "image/gif") return file;
  try {
    const { src, w, h } = await decode(file);
    const scale = Math.min(1, 2000 / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext("2d")!.drawImage(src, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ? new File([blob], (file.name || "stub").replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file; // The server checks what it really is and explains if it can't read it.
  }
}

export default function PaystubPage() {
  const { toast } = usePortal();
  const router = useRouter();
  const params = useSearchParams();
  // ?id=12 opens a saved check; ?for=34 attaches the next check to deal 34 (from the deal panel).
  const openId = Number(params.get("id")) || null;
  const forDeal = Number(params.get("for")) || null;
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A result that couldn't be saved (rare): shown, but not in the history. */
  const [unsaved, setUnsaved] = useState<Report | null>(null);
  const [opened, setOpened] = useState<SavedCheck | null>(null);
  const [history, setHistory] = useState<SavedCheck[] | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(async () => {
    const { data } = await supabase().from("paystub_checks").select(SAVED_COLUMNS).order("created_at", { ascending: false }).limit(200);
    setHistory((data ?? []) as SavedCheck[]);
  }, []);
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    setOpened(null);
    if (!openId) return;
    let alive = true;
    supabase()
      .from("paystub_checks")
      .select("*")
      .eq("id", openId)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        if (data) setOpened(data as SavedCheck);
        else {
          toast("That paystub check isn't there any more.", "warn");
          router.replace("/paystub");
        }
      });
    return () => {
      alive = false;
    };
  }, [openId, router, toast]);

  // Copy the files out straight away: clearing the picker (so the same file can be picked again)
  // empties its live file list, and React applies the update after that.
  function add(input: HTMLInputElement) {
    const picked = Array.from(input.files ?? []);
    input.value = "";
    if (!picked.length) return;
    setError(null);
    setUnsaved(null);
    setFiles((f) => [...f, ...picked].slice(0, MAX_FILES));
  }

  async function check() {
    if (!files.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await supabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sign in again.");
      const body = new FormData();
      const ready = await Promise.all(files.map(shrink));
      if (ready.reduce((t, f) => t + f.size, 0) > MAX_BYTES)
        throw new Error("Those files are too big together (over 4 MB). Check fewer at a time, or use photos instead of large PDFs.");
      for (const f of ready) body.append("file", f);
      const res = await fetch("/api/paystub", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
      const json = await res.json().catch(() => ({ error: res.status === 413 ? "Files are too big. Use fewer pages." : "Something went wrong. Try again." }));
      if (!res.ok) throw new Error(json.error || "Something went wrong. Try again.");
      const { report, id } = json as { report: Report; id: number | null };
      setFiles([]);
      if (id) {
        if (forDeal) {
          const { error: e } = await supabase().rpc("set_paystub_deal", { p_id: id, p_deal: forDeal });
          if (e) toast(errText(e), "warn");
        }
        loadHistory();
        router.replace(`/paystub?id=${id}`);
      } else {
        setUnsaved(report);
        toast("Checked, but it couldn't be saved. Copy the summary before you leave.", "warn");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const report = opened?.report ?? unsaved;

  function reset() {
    setFiles([]);
    setUnsaved(null);
    setError(null);
    if (openId) router.push("/paystub");
  }

  async function copy() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(reportText(report));
      toast("Summary copied. Paste it in the deal chat.", "ok");
    } catch {
      toast("Couldn't copy on this device.", "warn");
    }
  }

  return (
    <div className="stub">
      {openId && !opened && <div className="skel" style={{ height: 220 }} />}
      {opened && (
        <SavedBar
          check={opened}
          onChange={(c) => {
            setOpened(c);
            loadHistory();
          }}
          onDeleted={() => {
            loadHistory();
            router.replace("/paystub");
          }}
        />
      )}
      {!report && !openId && (
        <section className="scard stub-up">
          <h3>Check a pay stub</h3>
          <p>
            Take photos or upload PDFs. Add one stub, or the last 2–3 if the lender wants them, and they are checked against each other. You get the hourly
            rate, yearly income at 40 hours a week, time at the job, and anything that looks off. The summary is saved for TJ; the stub files are not kept.
          </p>

          {files.length > 0 && (
            <ul className="stub-files">
              {files.map((f, i) => (
                <li key={i}>
                  {I.stub}
                  <span>{f.name || `File ${i + 1}`}</span>
                  <button className="iconbtn" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} disabled={busy}>
                    {I.close}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="stub-pick">
            <button className="btn" onClick={() => photoRef.current?.click()} disabled={busy || files.length >= MAX_FILES}>
              {I.camera}
              {files.length ? "Add another" : "Take photo"}
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy || files.length >= MAX_FILES}>
              {I.clip}
              Upload PDF or image
            </button>
          </div>
          <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => add(e.currentTarget)} />
          <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf" multiple hidden onChange={(e) => add(e.currentTarget)} />

          {error && (
            <div className="stub-err" role="alert">
              {I.alert}
              {error}
            </div>
          )}

          <button className="btn primary stub-go" onClick={check} disabled={!files.length || busy}>
            {busy ? (
              <>
                <span className="spin" aria-hidden /> {files.length > 1 ? "Reading and comparing… (up to a minute)" : "Reading the stub… (about 20 seconds)"}
              </>
            ) : (
              <>
                {I.check}
                {files.length > 1 ? "Check stubs" : "Check pay stub"}
              </>
            )}
          </button>
          <small className="stub-tip">
            Tip: lay the stub flat in good light and fit the whole page in the photo. Up to {MAX_FILES} files: pages of one stub, or several stubs.
          </small>
        </section>
      )}

      {!report && !openId && forDeal && <ForDeal id={forDeal} />}
      {report && <PaystubReport report={report} onCopy={copy} onReset={reset} />}
      {!report && !openId && <History list={history} />}
    </div>
  );
}

/** "This check will be attached to <customer>" when started from a deal. */
function ForDeal({ id }: { id: number }) {
  const { deals } = usePortal();
  const d = deals.find((x) => x.id === id);
  if (!d) return null;
  return (
    <p className="stub-for">
      {I.clip} This check will be attached to <b>{fullName(d)}</b>&rsquo;s deal.
    </p>
  );
}

/** Who ran a saved check and when, plus attaching it to a deal and deleting it. */
function SavedBar({ check, onChange, onDeleted }: { check: SavedCheck; onChange: (c: SavedCheck) => void; onDeleted: () => void }) {
  const { me, person, deals, toast, openDeal } = usePortal();
  const [saving, setSaving] = useState(false);
  const by = person(check.created_by);
  const mine = check.created_by === me.id;
  const canAttach = mine || me.role !== "agent";
  const canDelete = mine || me.role === "admin";
  const deal = deals.find((d) => d.id === check.deal_id);
  const choices = [...deals].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || fullName(a).localeCompare(fullName(b)));

  async function attach(value: string) {
    const dealId = value ? Number(value) : null;
    setSaving(true);
    const { error } = await supabase().rpc("set_paystub_deal", { p_id: check.id, p_deal: dealId });
    setSaving(false);
    if (error) return toast(errText(error), "warn");
    onChange({ ...check, deal_id: dealId });
    const d = deals.find((x) => x.id === dealId);
    toast(d ? `Attached to ${fullName(d)}'s deal.` : "Removed from the deal.", "ok");
  }

  async function remove() {
    if (!confirm("Delete this paystub check? TJ won't be able to see it any more.")) return;
    const { error } = await supabase().from("paystub_checks").delete().eq("id", check.id);
    if (error) return toast(errText(error), "warn");
    toast("Paystub check deleted.", "ok");
    onDeleted();
  }

  return (
    <section className="scard stub-saved">
      <p className="stub-saved-who">
        {I.check}
        <span>
          Saved · checked by <b>{mine ? "you" : (by?.name ?? "someone")}</b> · {when(check.created_at)}
        </span>
      </p>
      <div className="stub-saved-row">
        <label className="field">
          <span className="flabel">Deal</span>
          {canAttach ? (
            <select className="input" value={check.deal_id ?? ""} onChange={(e) => attach(e.target.value)} disabled={saving}>
              <option value="">Not attached to a deal</option>
              {choices.map((d) => (
                <option key={d.id} value={d.id}>
                  {fullName(d)}
                  {isOpen(d) ? "" : " (closed)"}
                </option>
              ))}
            </select>
          ) : (
            <span>{deal ? fullName(deal) : "Not attached"}</span>
          )}
        </label>
        {deal && (
          <button className="btn" onClick={() => openDeal(deal.id)}>
            Open deal
          </button>
        )}
        {canDelete && (
          <button className="btn stub-del" onClick={remove} aria-label="Delete this check">
            {I.trash}
          </button>
        )}
      </div>
    </section>
  );
}

/** Past checks: your own, or everyone's for TJ and Sam. */
function History({ list }: { list: SavedCheck[] | null }) {
  const { me, person, deals } = usePortal();
  const router = useRouter();
  const [q, setQ] = useState("");
  const all = me.role !== "agent";
  const needle = q.trim().toLowerCase();
  const shown = (list ?? []).filter((c) => {
    if (!needle) return true;
    const d = deals.find((x) => x.id === c.deal_id);
    return [c.employee_name, c.employer_name, d && fullName(d), person(c.created_by)?.name].some((t) => t?.toLowerCase().includes(needle));
  });

  return (
    <section className="scard stub-history">
      <h3>{all ? "All paystub checks" : "Your paystub checks"}</h3>
      {list && list.length > 4 && (
        <input className="input" type="search" placeholder="Search by customer, employer or agent" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      {!list && <div className="skel" style={{ height: 120 }} />}
      {list && !list.length && <p>No checks yet. They show up here after you run one{all ? ", for everyone on the team" : ""}.</p>}
      {list && list.length > 0 && !shown.length && <p>Nothing matches “{q}”.</p>}
      <ul className="stub-hist">
        {shown.map((c) => {
          const d = deals.find((x) => x.id === c.deal_id);
          return (
            <li key={c.id}>
              <button onClick={() => router.push(`/paystub?id=${c.id}`)}>
                <span className="h-main">
                  <b>{c.employee_name || "Name not shown"}</b>
                  <small>
                    {c.employer_name || "Employer not shown"} · {c.stub_count} stub{c.stub_count === 1 ? "" : "s"}
                    {d ? ` · ${fullName(d)}'s deal` : ""}
                  </small>
                  <small className="h-who">
                    {c.created_by === me.id ? "You" : (person(c.created_by)?.name ?? "Someone")} · {when(c.created_at)}
                  </small>
                </span>
                <span className="h-side">
                  <b>{c.annual40 != null ? `${cad(c.annual40, false)}/yr` : "—"}</b>
                  <span className={`stub-badge ${c.warn_count ? "warn" : "ok"}`}>{c.warn_count ? `${c.warn_count} to check` : "OK"}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
