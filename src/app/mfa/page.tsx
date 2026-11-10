"use client";

import { useEffect, useState } from "react";
import { supabase, errText } from "@/lib/supabase/client";
import { I } from "@/components/ui";

type Mode = { kind: "loading" } | { kind: "enroll"; factorId: string; qr: string; secret: string } | { kind: "verify"; factorId: string };

export default function MfaPage() {
  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const sb = supabase();
      const { data, error } = await sb.auth.mfa.listFactors();
      if (error) return setError(errText(error));
      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) return setMode({ kind: "verify", factorId: verified.id });
      // Clear any half-finished setup, then start a fresh one.
      for (const f of data.all.filter((f) => f.status !== "verified")) await sb.auth.mfa.unenroll({ factorId: f.id });
      const en = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `Deal Portal ${Date.now()}` });
      if (en.error) return setError(errText(en.error));
      setMode({ kind: "enroll", factorId: en.data.id, qr: en.data.totp.qr_code, secret: en.data.totp.secret });
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode.kind === "loading") return;
    setBusy(true);
    setError("");
    const { error } = await supabase().auth.mfa.challengeAndVerify({ factorId: mode.factorId, code: code.replace(/\D/g, "") });
    if (error) {
      setError("That code didn’t work. Codes change every 30 seconds, so use the newest one.");
      setBusy(false);
      return;
    }
    window.location.href = "/deals";
  }

  async function signOut() {
    await supabase().auth.signOut();
    window.location.href = "/login";
  }

  return (
    <main className="auth">
      <form className="authcard" onSubmit={submit}>
        <div className="brand">
          <span className="mark">{I.logo}</span>Deal Portal
        </div>
        {mode.kind === "enroll" && (
          <>
            <div>
              <h1>Set up two-step verification</h1>
              <p>Scan this with an authenticator app such as Google Authenticator or Microsoft Authenticator, then type the 6-digit code it shows.</p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="qr" src={mode.qr} alt="QR code for your authenticator app" />
            <div className="field">
              <span className="flabel">Can’t scan? Enter this key instead</span>
              <span className="secret">{mode.secret}</span>
            </div>
          </>
        )}
        {mode.kind === "verify" && (
          <div>
            <h1>Enter your code</h1>
            <p>Open your authenticator app and type the 6-digit code for Deal Portal.</p>
          </div>
        )}
        {mode.kind === "loading" && !error && <div className="skel" style={{ height: 120 }} />}
        {mode.kind !== "loading" && (
          <div className="field">
            <label htmlFor="code">6-digit code</label>
            <input
              className="input codeinput"
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
        )}
        {error && <p className="err" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy || mode.kind === "loading"}>{busy ? "Checking…" : "Verify"}</button>
        <button type="button" className="btn" onClick={signOut}>Use a different account</button>
      </form>
    </main>
  );
}
