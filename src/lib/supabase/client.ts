import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return client;
}

/** Turns a Supabase/Postgres error into the plain sentence the database raised. */
export function errText(e: unknown): string {
  if (!e) return "Something went wrong. Try again.";
  if (typeof e === "string") return e;
  const m = (e as { message?: string }).message;
  return m || "Something went wrong. Try again.";
}
