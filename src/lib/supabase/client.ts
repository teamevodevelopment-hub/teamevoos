import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "./config";

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    client = createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return client;
}

// Plain-English versions of the database's value checks.
const CHECKS: [RegExp, string][] = [
  [/deals_vin_check/, "A VIN is 17 letters and numbers, with no I, O or Q."],
  [/vehicle_year_check/, "Enter a model year between 1980 and 2100."],
  [/vehicle_km_check/, "Kilometres look off. Enter a number like 45000."],
  [/rate_check/, "Enter a rate between 0 and 60%."],
  [/term_months_check/, "Enter a term between 6 and 120 months."],
  [/(amount|payment|down_payment|trade_in_value|vehicle_price)_check/, "That amount looks off. Check the number."],
  [/(vehicle_make|vehicle_model|vehicle_trim|trade_in_desc|label)_check/, "That's too long. Shorten it a bit."],
];

/** Turns a Supabase/Postgres error into the plain sentence the database raised. */
export function errText(e: unknown): string {
  if (!e) return "Something went wrong. Try again.";
  if (typeof e === "string") return e;
  const m = (e as { message?: string }).message;
  const hit = m && CHECKS.find(([re]) => re.test(m));
  return hit ? hit[1] : m || "Something went wrong. Try again.";
}
