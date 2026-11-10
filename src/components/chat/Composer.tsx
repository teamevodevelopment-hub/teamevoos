"use client";

import { useEffect, useRef, useState } from "react";
import { usePortal } from "../PortalProvider";
import { Avatar, Chip, I } from "../ui";
import { fullName } from "@/lib/stages";
import { MAX_FILE, fmtDuration, fmtSize, uploadChatFile, type Attachment } from "@/lib/chatFiles";
import type { Deal, Profile } from "@/lib/types";

export const PICKER = [
  "😀", "😂", "🤣", "😅", "😊", "😍", "🤩", "😎", "🤔", "😴", "😤", "🥳",
  "👍", "👎", "👏", "🙌", "🙏", "💪", "🤝", "👀", "🔥", "💯", "🎉", "🚀",
  "❤️", "💸", "💰", "🏆", "⭐", "✅", "❌", "⏰", "☕", "🍕", "🚗", "🔑",
];

export interface Mentionable {
  key: string;
  label: string;
  sub?: string;
  profile?: Profile;
}

type Pop = { kind: "mention" | "deal"; q: string; sel: number } | null;

const ACCEPT = "image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,video/mp4,video/quicktime";
const MAX_VOICE_MS = 5 * 60_000;

/** Voice recording format: iPhones record MP4/AAC, which every phone and browser can play. */
function voiceType() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return "";
}

export function Composer(props: {
  id: string;
  /** Private storage folder for this chat: "team", "deal/<id>" or "dm/<pair key>". */
  folder: string;
  placeholder: string;
  mentionables?: Mentionable[];
  dealTokens?: boolean;
  replyTo?: { name: string; text: string } | null;
  onCancelReply?: () => void;
  onTyping?: () => void;
  /** Saves the message. Return false to keep what was typed. */
  onSend: (body: string, file: Attachment | null) => Promise<boolean>;
}) {
  const { deals, toast } = usePortal();
  const [text, setText] = useState("");
  const [pop, setPop] = useState<Pop>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [picked, setPicked] = useState<{ label: string; id: number }[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [rec, setRec] = useState<{ started: number; now: number } | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const recorder = useRef<{ mr: MediaRecorder; chunks: Blob[]; stream: MediaStream; send: boolean } | null>(null);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  useEffect(() => () => recorder.current?.stream.getTracks().forEach((t) => t.stop()), []);

  type Opt = Mentionable & { deal?: Deal };
  const options: Opt[] = !pop
    ? []
    : pop.kind === "mention"
      ? (props.mentionables ?? []).filter((o) => o.label.toLowerCase().startsWith(pop.q.toLowerCase()))
      : deals
          .filter((d) => fullName(d).toLowerCase().includes(pop.q.toLowerCase()))
          .slice(0, 6)
          .map((d) => ({ key: String(d.id), label: fullName(d), deal: d }));

  function resize() {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }

  function onInput(v: string) {
    setText(v);
    requestAnimationFrame(resize);
    const before = v.slice(0, ta.current?.selectionStart ?? v.length);
    const m = props.mentionables ? before.match(/@(\w*)$/) : null;
    const d = props.dealTokens ? before.match(/#([\w' -]*)$/) : null;
    setPop(m ? { kind: "mention", q: m[1], sel: 0 } : d && d[1].length <= 30 ? { kind: "deal", q: d[1], sel: 0 } : null);
    if (props.onTyping && Date.now() - lastTyping.current > 2000) {
      lastTyping.current = Date.now();
      props.onTyping();
    }
  }

  function insertAtCaret(insert: string, pattern?: RegExp) {
    const el = ta.current!;
    const pos = el.selectionStart;
    const head = pattern ? text.slice(0, pos).replace(pattern, insert) : text.slice(0, pos) + insert;
    setText(head + text.slice(pos));
    setPop(null);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = head.length;
      resize();
    });
  }

  function choose(o: Opt) {
    if (pop?.kind === "deal" && o.deal) {
      const label = `#${o.label}`;
      setPicked((p) => [...p.filter((x) => x.label !== label), { label, id: o.deal!.id }]);
      insertAtCaret(`${label} `, /#([\w' -]*)$/);
    } else insertAtCaret(`@${o.label} `, /@(\w*)$/);
  }

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_FILE && !f.type.startsWith("image/")) return toast("That file is over 25 MB. Send a smaller one.", "warn");
    setFile(f);
    setPreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
    ta.current?.focus();
  }

  function clearFile() {
    setFile(null);
    setPreview(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function deliver(body: string, att: Attachment | null) {
    const ok = await props.onSend(body, att);
    if (ok) {
      setText("");
      setPicked([]);
      clearFile();
      requestAnimationFrame(resize);
    }
    return ok;
  }

  async function send() {
    let body = text.trim();
    if ((!body && !file) || sending) return;
    // Deal names typed with # become deal cards, so the customer's name isn't stored in the message.
    for (const p of [...picked].sort((a, b) => b.label.length - a.label.length)) body = body.split(p.label).join(`#[deal:${p.id}]`);
    setSending(true);
    try {
      const att = file ? await uploadChatFile(props.folder, file, { name: file.name, kind: file.type.startsWith("image/") ? "image" : "file" }) : null;
      await deliver(body, att);
    } catch (e) {
      toast((e as Error).message || "Couldn’t send. Try again.", "warn");
    } finally {
      setSending(false);
    }
  }

  async function startVoice() {
    const type = voiceType();
    if (type === null || !navigator.mediaDevices?.getUserMedia) return toast("Voice notes don’t work in this browser.", "warn");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return toast("Allow the microphone to record voice notes. On iPhone: Settings → Safari → Microphone.", "warn");
    }
    const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const r = { mr, chunks: [] as Blob[], stream, send: false };
    recorder.current = r;
    const started = Date.now();
    mr.ondataavailable = (e) => e.data.size && r.chunks.push(e.data);
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      setRec(null);
      if (!r.send) return;
      const ms = Date.now() - started;
      if (ms < 700) return toast("Hold on a little longer to record.", "warn");
      const blobType = (mr.mimeType || type || "audio/mp4").split(";")[0];
      const blob = new Blob(r.chunks, { type: blobType });
      setSending(true);
      try {
        const att = await uploadChatFile(props.folder, blob, { name: `voice.${blobType.includes("webm") ? "webm" : "m4a"}`, kind: "voice", ms });
        await deliver("", att);
      } catch (e) {
        toast((e as Error).message || "Couldn’t send the voice note.", "warn");
      } finally {
        setSending(false);
      }
    };
    mr.start(250);
    setRec({ started, now: started });
  }

  function stopVoice(sendIt: boolean) {
    const r = recorder.current;
    if (!r) return;
    r.send = sendIt;
    r.mr.stop();
  }

  // Recording timer, with an automatic stop at five minutes.
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => {
      const now = Date.now();
      if (now - rec.started >= MAX_VOICE_MS) stopVoice(true);
      else setRec((r) => (r ? { ...r, now } : r));
    }, 250);
    return () => clearInterval(t);
  }, [rec?.started]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasContent = !!text.trim() || !!file;

  return (
    <form
      className="composer tm-composer"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {props.replyTo && (
        <div className="tm-replying">
          {I.reply}
          <span>
            Replying to <b>{props.replyTo.name}</b>: {props.replyTo.text}
          </span>
          <button type="button" className="iconbtn" onClick={props.onCancelReply} aria-label="Cancel reply">
            {I.close}
          </button>
        </div>
      )}
      {file && (
        <div className="att-pending">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt="" /> : <span className="att-ext">{(file.name.split(".").pop() ?? "").slice(0, 4).toUpperCase() || "FILE"}</span>}
          <span className="att-meta">
            <b>{file.name}</b>
            <small>{sending ? "Sending…" : `${fmtSize(file.size)} · add a caption or send`}</small>
          </span>
          <button type="button" className="iconbtn" onClick={clearFile} aria-label="Remove attachment" disabled={sending}>
            {I.close}
          </button>
        </div>
      )}
      {pop && options.length > 0 && (
        <div className="mpop" role="listbox">
          {options.map((o, i) => (
            <button type="button" key={o.key} className={i === pop.sel ? "sel" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}>
              {o.profile ? <Avatar p={o.profile} size="sm" /> : o.deal ? null : <span className="av sm">@</span>}
              {o.label}
              {o.deal ? <Chip stage={o.deal.stage} /> : <small>{o.sub ?? ""}</small>}
            </button>
          ))}
        </div>
      )}
      {emojiOpen && (
        <div className="emoji-grid composer-grid" role="listbox">
          {PICKER.map((e) => (
            <button
              type="button"
              key={e}
              onClick={() => {
                insertAtCaret(e);
                setEmojiOpen(false);
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
      {rec ? (
        <div className="box recording" role="status">
          <button type="button" className="iconbtn" onClick={() => stopVoice(false)} aria-label="Cancel voice note">
            {I.trash}
          </button>
          <span className="rec-dot" aria-hidden />
          <span className="rec-time tnum">{fmtDuration(rec.now - rec.started)}</span>
          <span className="rec-hint">Recording…</span>
          <button type="button" className="btn primary sendbtn" onClick={() => stopVoice(true)} aria-label="Send voice note">
            {I.send}
          </button>
        </div>
      ) : (
        <div className="box">
          <button type="button" className="iconbtn" aria-label="Emoji" onClick={() => setEmojiOpen((o) => !o)}>
            {I.smile}
          </button>
          <textarea
            ref={ta}
            id={props.id}
            rows={1}
            value={text}
            placeholder={props.placeholder}
            aria-label={props.placeholder}
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
                  return choose(options[pop.sel]);
                }
                if (e.key === "Escape") {
                  e.stopPropagation();
                  return setPop(null);
                }
              }
              // On phones Enter adds a line, like WhatsApp; on computers Enter sends.
              if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer:coarse)").matches) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button type="button" className="iconbtn" aria-label="Attach a photo or file" onClick={() => fileInput.current?.click()} disabled={sending}>
            {I.clip}
          </button>
          <input ref={fileInput} type="file" accept={ACCEPT} hidden onChange={(e) => pickFile(e.target.files?.[0])} />
          {hasContent ? (
            <button className="btn primary sendbtn" aria-label="Send" disabled={sending}>
              {I.send}
            </button>
          ) : (
            <button type="button" className="btn primary sendbtn" aria-label="Record a voice note" onClick={startVoice} disabled={sending}>
              {I.mic}
            </button>
          )}
        </div>
      )}
    </form>
  );
}
