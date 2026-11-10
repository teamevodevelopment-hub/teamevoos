"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase/client";
import type { FileKind } from "./types";

export interface Attachment {
  file_path: string;
  file_kind: FileKind;
  file_name: string | null;
  file_size: number | null;
  file_ms: number | null;
}

export const MAX_FILE = 25 * 1024 * 1024;

/** The pair's folder name for private chats: the same whichever way round. */
export const dmKey = (a: string, b: string) => [a, b].sort().join("_");

const safeName = (n: string) =>
  n
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(-80) || "file";

/** Phone photos are huge (and often HEIC). Shrink to a 1600px JPEG so they send fast and open everywhere. */
async function shrinkPhoto(file: File): Promise<{ blob: Blob; name: string }> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.84));
    if (blob) return { blob, name: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
  } catch {}
  return { blob: file, name: file.name };
}

/**
 * Uploads to the chat's private folder: "team", "deal/<id>" or "dm/<pair key>".
 * Only people in that chat can open it.
 */
export async function uploadChatFile(folder: string, file: File | Blob, opts: { name: string; kind: FileKind; ms?: number }): Promise<Attachment> {
  let blob: Blob = file;
  let name = opts.name;
  if (opts.kind === "image" && file instanceof File && file.type !== "image/gif") ({ blob, name } = await shrinkPhoto(file));
  if (blob.size > MAX_FILE) throw new Error("That file is over 25 MB. Send a smaller one.");
  const type = (blob.type || "application/octet-stream").split(";")[0];
  const path = `${folder}/${crypto.randomUUID()}-${safeName(name)}`;
  const { error } = await supabase().storage.from("chat-files").upload(path, blob, { contentType: type });
  if (error) throw new Error(/mime|type/i.test(error.message) ? "That kind of file can’t be sent. Try a photo, PDF or document." : error.message);
  return { file_path: path, file_kind: opts.kind, file_name: name, file_size: blob.size, file_ms: opts.ms ?? null };
}

// Signed links last an hour; keep them so scrolling doesn't re-request every image.
const cache = new Map<string, { url: string; until: number }>();

export function useFileUrl(path: string | null | undefined) {
  const hit = path ? cache.get(path) : undefined;
  const [url, setUrl] = useState<string | null>(hit && hit.until > Date.now() ? hit.url : null);
  useEffect(() => {
    if (!path) return;
    const c = cache.get(path);
    if (c && c.until > Date.now()) return setUrl(c.url);
    let alive = true;
    supabase()
      .storage.from("chat-files")
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!alive || !data) return;
        cache.set(path, { url: data.signedUrl, until: Date.now() + 3_300_000 });
        setUrl(data.signedUrl);
      });
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}

export const fmtDuration = (ms: number | null | undefined) => {
  const s = Math.max(0, Math.round((ms ?? 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const fmtSize = (b: number | null | undefined) =>
  !b ? "" : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

/** What a message says in a list preview or reply quote. */
export function previewText(m: { body: string; file_kind?: FileKind | null; file_name?: string | null; file_ms?: number | null; deleted_at?: string | null }) {
  if (m.deleted_at) return "Message deleted";
  const text = m.body.replace(/#\[deal:\d+\]/g, "a deal").trim();
  const file =
    m.file_kind === "image" ? "📷 Photo" : m.file_kind === "voice" ? `🎤 Voice note (${fmtDuration(m.file_ms)})` : m.file_kind === "file" ? `📄 ${m.file_name ?? "File"}` : "";
  return [file, text].filter(Boolean).join(" ") || "Message";
}
