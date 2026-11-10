import { timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { VAPID_PUBLIC_KEY } from "@/lib/pushKey";

// The database calls this when a message needs to reach people's phones.
// It proves itself with PUSH_SECRET, then hands each notification to Apple's (or Google's) push service.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Sub {
  endpoint: string;
  p256dh: string;
  auth: string;
  badge?: number;
}
interface Payload {
  subs: Sub[];
  title: string;
  body: string;
  url: string;
  tag: string;
}

function sameSecret(given: string | null, real: string) {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(real);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const secret = process.env.PUSH_SECRET;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!secret || !privateKey) return Response.json({ error: "Push isn't set up on this server." }, { status: 503 });
  if (!sameSecret(req.headers.get("x-push-secret"), secret)) return Response.json({ error: "Not allowed." }, { status: 401 });

  let p: Payload;
  try {
    p = (await req.json()) as Payload;
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  const subs = (Array.isArray(p.subs) ? p.subs : []).filter((s) => typeof s?.endpoint === "string" && s.endpoint.startsWith("https://")).slice(0, 50);

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://teamevoos.vercel.app", VAPID_PUBLIC_KEY, privateKey);

  const gone: string[] = [];
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: String(p.title ?? ""), body: String(p.body ?? ""), url: String(p.url ?? "/deals"), tag: String(p.tag ?? ""), badge: s.badge ?? null }),
          { TTL: 60 * 60 * 24, urgency: "high" },
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        // 404/410: the phone removed the app or turned notifications off. Forget it.
        if (code === 404 || code === 410) gone.push(s.endpoint);
        else console.error("Push failed", code, (e as Error).message);
      }
    }),
  );

  if (gone.length) {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/push_gone`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ p_endpoints: gone, p_secret: secret }),
    }).catch(() => {});
  }
  return Response.json({ sent, gone: gone.length });
}
