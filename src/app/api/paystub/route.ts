import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { STUB_PROMPT, STUB_SCHEMA, analyse, type StubRead } from "@/lib/paystub";

// Paystub Verifier: a signed-in teammate sends 1–4 pages/photos of a pay stub; Claude reads it,
// and lib/paystub.ts works out the income. Nothing is saved: the files go to Claude and are dropped.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_FILES = 4;
const MAX_TOTAL = 4 * 1024 * 1024; // Vercel caps request bodies at 4.5 MB; the app shrinks photos first.
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

const fail = (error: string, status: number) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail("The Paystub Verifier isn't switched on yet. Add ANTHROPIC_API_KEY in Vercel.", 503);

  // Only signed-in team members.
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return fail("Sign in again.", 401);
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth } = await sb.auth.getUser(token);
  if (!auth.user) return fail("Sign in again.", 401);
  const { data: prof } = await sb.from("profiles").select("id").eq("id", auth.user.id).maybeSingle();
  if (!prof) return fail("Only team members can use this.", 403);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Couldn't read the upload. Try again.", 400);
  }
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return fail("Add a photo or PDF of the pay stub.", 400);
  if (files.length > MAX_FILES) return fail(`Up to ${MAX_FILES} pages at a time.`, 400);
  if (files.reduce((t, f) => t + f.size, 0) > MAX_TOTAL) return fail("Files are too big. Use fewer pages or a smaller PDF (under 4 MB).", 413);

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const f of files) {
    const data = Buffer.from(await f.arrayBuffer()).toString("base64");
    if (f.type === "application/pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
    } else if ((IMAGE_TYPES as readonly string[]).includes(f.type)) {
      content.push({ type: "image", source: { type: "base64", media_type: f.type as ImageType, data } });
    } else {
      return fail("Use a photo (JPG or PNG) or a PDF.", 400);
    }
  }
  content.push({ type: "text", text: files.length > 1 ? `These ${files.length} files are pages of the same pay stub. Read it.` : "Read this pay stub." });

  const client = new Anthropic({ apiKey });
  let msg: Anthropic.Beta.BetaMessage;
  try {
    msg = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      // If a safety check ever declines, Anthropic retries on its recommended backup model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: STUB_SCHEMA as unknown as Record<string, unknown> } },
      system: STUB_PROMPT,
      messages: [{ role: "user", content }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return fail("Too many checks at once. Wait a minute and try again.", 429);
    if (e instanceof Anthropic.AuthenticationError) return fail("The Claude API key is wrong or expired. Update ANTHROPIC_API_KEY in Vercel.", 503);
    if (e instanceof Anthropic.BadRequestError) return fail("Claude couldn't open that file. Try a clearer photo or a different PDF.", 400);
    if (e instanceof Anthropic.APIError) return fail("Claude is busy right now. Try again in a minute.", 502);
    return fail("Couldn't reach Claude. Try again.", 502);
  }

  if (msg.stop_reason === "refusal") return fail("Claude wouldn't read this file. Make sure it's a pay stub.", 422);
  if (msg.stop_reason === "max_tokens") return fail("This stub was too long to read in one go. Try one page at a time.", 422);
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let read: StubRead;
  try {
    read = JSON.parse(text) as StubRead;
  } catch {
    return fail("Claude's answer came back garbled. Try again.", 502);
  }
  if (!read.is_pay_stub) return fail(read.problem || "That doesn't look like a pay stub.", 422);

  return Response.json(analyse(read));
}
