"use client";

import { useEffect, useRef, useState } from "react";
import { I } from "../ui";
import { fmtDuration, fmtSize, useFileUrl } from "@/lib/chatFiles";
import type { FileFields } from "@/lib/types";

/** A photo, file or voice note inside a message. */
export function Attachment({ m }: { m: FileFields }) {
  if (!m.file_path || !m.file_kind) return null;
  if (m.file_kind === "image") return <Photo path={m.file_path} />;
  if (m.file_kind === "voice") return <Voice path={m.file_path} ms={m.file_ms ?? 0} />;
  return <FileCard path={m.file_path} name={m.file_name} size={m.file_size} />;
}

function Photo({ path }: { path: string }) {
  const url = useFileUrl(path);
  const [big, setBig] = useState(false);
  return (
    <>
      <button
        className="att-photo"
        aria-label="Open photo"
        onClick={(e) => {
          e.stopPropagation();
          if (url) setBig(true);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt="Photo" loading="lazy" /> : <span className="skel" />}
      </button>
      {big && url && (
        <div
          className="lightbox"
          role="dialog"
          aria-label="Photo"
          onClick={(e) => {
            e.stopPropagation();
            setBig(false);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Photo" />
          <div className="lb-bar">
            <a className="btn" href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              Open original
            </a>
            <button className="btn" onClick={() => setBig(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function FileCard({ path, name, size }: { path: string; name?: string | null; size?: number | null }) {
  const url = useFileUrl(path);
  const ext = (name?.split(".").pop() ?? "").slice(0, 4).toUpperCase();
  return (
    <a className="att-file" href={url ?? undefined} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} aria-disabled={!url}>
      <span className="att-ext">{ext || "FILE"}</span>
      <span className="att-meta">
        <b>{name ?? "File"}</b>
        <small>{[fmtSize(size), url ? "Tap to open" : "Loading…"].filter(Boolean).join(" · ")}</small>
      </span>
    </a>
  );
}

function Voice({ path, ms }: { path: string; ms: number }) {
  const url = useFileUrl(path);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const total = ms / 1000;

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const tick = () => setPos(a.currentTime);
    const end = () => {
      setPlaying(false);
      setPos(0);
    };
    a.addEventListener("timeupdate", tick);
    a.addEventListener("ended", end);
    a.addEventListener("pause", () => setPlaying(false));
    a.addEventListener("play", () => setPlaying(true));
    return () => {
      a.removeEventListener("timeupdate", tick);
      a.removeEventListener("ended", end);
    };
  }, [url]);

  const pct = total ? Math.min(100, (pos / total) * 100) : 0;
  return (
    <div className="att-voice" onClick={(e) => e.stopPropagation()}>
      <button
        className="vplay"
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        disabled={!url}
        onClick={() => {
          const a = audio.current;
          if (!a) return;
          // Only one voice note plays at a time.
          document.querySelectorAll("audio").forEach((x) => x !== a && x.pause());
          if (a.paused) a.play().catch(() => {});
          else a.pause();
        }}
      >
        {playing ? I.pause : I.play}
      </button>
      <span
        className="vbar"
        role="slider"
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(pos)}
        tabIndex={0}
        onClick={(e) => {
          const a = audio.current;
          if (!a || !total) return;
          const r = e.currentTarget.getBoundingClientRect();
          a.currentTime = ((e.clientX - r.left) / r.width) * total;
        }}
      >
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="vtime tnum">{fmtDuration((playing || pos ? pos : total) * 1000)}</span>
      {url && <audio ref={audio} src={url} preload="metadata" />}
    </div>
  );
}
