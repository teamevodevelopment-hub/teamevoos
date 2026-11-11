"use client";

import { useRef, useState } from "react";
import { usePortal } from "@/components/PortalProvider";
import { I } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { summaryText, type Analysis } from "@/lib/paystub";
import { PaystubResult } from "@/components/PaystubResult";

const MAX_FILES = 4;

/** Phone photos are often 3–6 MB. Shrink them so the upload is quick and fits the server limit. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file; // e.g. HEIC the browser can't open; the server will say so.
  }
}

export default function PaystubPage() {
  const { toast } = usePortal();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Analysis | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function add(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    setResult(null);
    setFiles((f) => [...f, ...Array.from(list)].slice(0, MAX_FILES));
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
      for (const f of await Promise.all(files.map(shrink))) body.append("file", f);
      const res = await fetch("/api/paystub", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
      const json = await res.json().catch(() => ({ error: res.status === 413 ? "Files are too big. Use fewer pages." : "Something went wrong. Try again." }));
      if (!res.ok) throw new Error(json.error || "Something went wrong. Try again.");
      setResult(json as Analysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setFiles([]);
    setResult(null);
    setError(null);
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(summaryText(result));
      toast("Summary copied. Paste it in the deal chat.", "ok");
    } catch {
      toast("Couldn't copy on this device.", "warn");
    }
  }

  return (
    <div className="stub">
      {!result && (
        <section className="scard stub-up">
          <h3>Check a pay stub</h3>
          <p>Take a photo or upload the PDF. You get the hourly rate, yearly income at 40 hours a week, time at the job, and anything that looks off. Nothing is saved.</p>

          {files.length > 0 && (
            <ul className="stub-files">
              {files.map((f, i) => (
                <li key={i}>
                  {I.stub}
                  <span>{f.name || `Page ${i + 1}`}</span>
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
              {files.length ? "Add a page" : "Take photo"}
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy || files.length >= MAX_FILES}>
              {I.clip}
              Upload PDF or image
            </button>
          </div>
          <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
          <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => (add(e.target.files), (e.target.value = ""))} />

          {error && (
            <div className="stub-err" role="alert">
              {I.alert}
              {error}
            </div>
          )}

          <button className="btn primary stub-go" onClick={check} disabled={!files.length || busy}>
            {busy ? (
              <>
                <span className="spin" aria-hidden /> Reading the stub… (about 20 seconds)
              </>
            ) : (
              <>
                {I.check}Check pay stub
              </>
            )}
          </button>
          <small className="stub-tip">Tip: lay the stub flat in good light and fit the whole page in the photo. Up to {MAX_FILES} pages.</small>
        </section>
      )}

      {result && <PaystubResult a={result} onCopy={copy} onReset={reset} />}
    </div>
  );
}
