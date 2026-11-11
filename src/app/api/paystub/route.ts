import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { STUB_PROMPT, UPLOAD_SCHEMA, buildReport, toUpload, type UploadRead } from "@/lib/paystub";

// Paystub Verifier: a signed-in teammate sends up to 8 files: one pay stub, or several (lenders often want 2–3).
// Claude reads and groups them; lib/paystub.ts works out the income and compares the stubs. Nothing is saved: the files go to Claude and are dropped.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_FILES = 8;
const MAX_TOTAL = 4 * 1024 * 1024; // Vercel caps request bodies at 4.5 MB; the app shrinks photos first.
type ImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

/** What a file really is, from its first bytes. Phones don't always label files (or label them wrongly). */
function sniff(b: Buffer): ImageType | "application/pdf" | null {
  if (b.subarray(0, 1024).includes("%PDF-")) return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (b.toString("latin1", 0, 4) === "GIF8") return "image/gif";
  return null;
}

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
  if (files.length > MAX_FILES) return fail(`Up to ${MAX_FILES} files at a time.`, 400);
  if (files.reduce((t, f) => t + f.size, 0) > MAX_TOTAL) return fail("Files are too big. Use fewer files or smaller PDFs (under 4 MB in total).", 413);

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const [i, f] of files.entries()) {
    const bytes = Buffer.from(await f.arrayBuffer());
    const kind = sniff(bytes);
    if (!kind) {
      return fail(
        /heic|heif/i.test(f.type) || /\.hei[cf]$/i.test(f.name)
          ? "That photo is in HEIC format, which can't be read. Take the photo with the Take photo button instead, or upload a PDF."
          : "Use a photo (JPG or PNG) or a PDF.",
        400,
      );
    }
    const data = bytes.toString("base64");
    content.push({ type: "text", text: `File ${i + 1}:` });
    if (kind === "application/pdf")
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data },
      });
    else
      content.push({
        type: "image",
        source: { type: "base64", media_type: kind, data },
      });
  }
  content.push({
    type: "text",
    text: files.length > 1 ? `Those are ${files.length} files: pages of one pay stub, or several pay stubs. Read them.` : "Read this pay stub.",
  });

  const client = new Anthropic({ apiKey });
  let msg: Anthropic.Beta.BetaMessage;
  try {
    // Streamed so a long read (several stubs) can't hit a request timeout.
    msg = await client.beta.messages
      .stream({
        model: "claude-opus-5-5",
        max_tokens: 32000,
        // If a safety check ever declines, Anthropic retries on its recommended backup model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: {
          effort: "medium",
          format: {
            type: "json_schema",
            schema: UPLOAD_SCHEMA as unknown as Record<string, unknown>,
          },
        },
        system: STUB_PROMPT,
        messages: [{ role: "user", content }],
      })
      .finalMessage();
  } catch (e) {
    // The real reason goes to the Vercel logs (Deployments → Logs), never to the screen.
    console.error("paystub: Claude request failed", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
    if (e instanceof Anthropic.RateLimitError) return fail("Too many checks at once. Wait a minute and try again.", 429);
    if (e instanceof Anthropic.AuthenticationError) return fail("The Claude API key is wrong or expired. Update ANTHROPIC_API_KEY in Vercel.", 503);
    if (e instanceof Anthropic.BadRequestError) {
      // Only blame the file when Claude says it's the file.
      const fileProblem = /pdf|image|document|media|base64|page/i.test(e.message);
      return fail(
        fileProblem
          ? "Claude couldn't open that file. Try a clearer photo or a different PDF."
          : "The verifier hit a setup problem on our side, not your file. Tell TJ; the details are in the Vercel logs.",
        fileProblem ? 400 : 500,
      );
    }
    if (e instanceof Anthropic.APIError) return fail("Claude is busy right now. Try again in a minute.", 502);
    return fail("Couldn't reach Claude. Try again.", 502);
  }

  if (msg.stop_reason === "refusal") return fail("Claude wouldn't read this file. Make sure it's a pay stub.", 422);
  if (msg.stop_reason === "max_tokens") return fail("Too much to read in one go. Try fewer stubs at a time.", 422);
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let read: UploadRead;
  try {
    read = toUpload(JSON.parse(text));
  } catch (e) {
    console.error("paystub: answer wasn't JSON", e, text.slice(0, 500));
    return fail("Claude's answer came back garbled. Try again.", 502);
  }
  const report = buildReport(read);
  if (!report.stubs.length) return fail(read.problem || read.stubs.find((s) => s.problem)?.problem || "That doesn't look like a pay stub.", 422);

  return Response.json(report);
}
