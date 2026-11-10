"use client";

import { useState } from "react";
import { supabase, errText } from "@/lib/supabase/client";
import { I } from "@/components/ui";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(error.message === "Invalid login credentials" ? "That email and password don’t match. Try again." : errText(error));
      setBusy(false);
      return;
    }
    window.location.href = "/deals";
  }

  return (
    <main className="auth">
      <form className="authcard" onSubmit={submit}>
        <div className="brand">
          <span className="mark">{I.logo}</span>Deal Portal
        </div>
        <div>
          <h1>Sign in</h1>
          <p>Use the email TJ set up for you.</p>
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input className="input" id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input className="input" id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="err" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? "Signing in…" : "Continue"}</button>
      </form>
    </main>
  );
}
