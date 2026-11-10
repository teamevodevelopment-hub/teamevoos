// The project URL and publishable key are public by design: every visitor's browser receives them.
// Access is protected by sign-in and the database's row-level security, not by hiding these.
// Environment variables override them (e.g. to point a test copy at another project).
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://louwkmwvieabyshxwsdg.supabase.co";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_SEyzjECtXJVZeVKqE0I5_g_V63BjXmn";
