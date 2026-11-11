"use client";

import { useRef, useState } from "react";
import { usePortal } from "@/components/PortalProvider";
import { I } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { reportText, type Report } from "@/lib/paystub";
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
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Report | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Copy the files out straight away: clearing the picker (so the same file can be picked again)
  // empties its live file list, and React applies the update after that.
  function add(input: HTMLInputElement) {
    const picked = Array.from(input.files ?? []);
    input.value = "";
    if (!picked.length) return;
    setError(null);
    setResult(null);
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
      setResult(json as Report);
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
      await navigator.clipboard.writeText(reportText(result));
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
          <p>
            Take photos or upload PDFs. Add one stub, or the last 2–3 if the lender wants them, and they are checked against each other. You get the hourly
            rate, yearly income at 40 hours a week, time at the job, and anything that looks off. Nothing is saved.
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

      {result && <PaystubReport report={result} onCopy={copy} onReset={reset} />}
    </div>
  );
}
