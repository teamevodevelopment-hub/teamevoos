"use client";

import { useEffect, useState } from "react";
import { usePortal } from "./PortalProvider";
import { I } from "./ui";
import { enablePush, isIOS, pushState, type PushState } from "@/lib/push";

const DISMISS = "pushBannerHidden";

/** Asks once to turn on notifications. On an iPhone browser tab, explains installing the app first. */
export function PushBanner() {
  const { toast } = usePortal();
  const [state, setState] = useState<PushState | null>(null);
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    pushState().then(setState);
    try {
      setHidden(localStorage.getItem(DISMISS) === "1");
    } catch {
      setHidden(false);
    }
  }, []);

  if (hidden || !state || state === "on" || state === "unsupported") return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS, "1");
    } catch {}
  };

  return (
    <div className={`pushbanner ${state}`} role="region" aria-label="Notifications">
      <span className="pb-ic">{I.bell}</span>
      <div className="pb-t">
        {state === "needs-install" ? (
          <>
            <b>Get notifications like WhatsApp</b>
            <span>
              Install the app first: tap <b>Share</b> {I.share} then <b>Add to Home Screen</b>, and open it from your home screen.
            </span>
          </>
        ) : state === "denied" ? (
          <>
            <b>Notifications are blocked</b>
            <span>{isIOS() ? "Turn them on in Settings → Notifications → Deals." : "Allow notifications for this site in your browser settings."}</span>
          </>
        ) : (
          <>
            <b>Turn on notifications</b>
            <span>Get messages, mentions and deal updates on your lock screen, even when the app is closed.</span>
          </>
        )}
      </div>
      {state === "off" && (
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const s = await enablePush();
              setState(s);
              if (s === "on") toast("Notifications are on", "ok");
              else if (s === "denied") toast("Notifications were blocked. You can turn them on in Settings.", "warn");
            } catch {
              toast("Couldn’t turn on notifications. Try again.", "warn");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Turning on…" : "Turn on"}
        </button>
      )}
      <button className="iconbtn" onClick={dismiss} aria-label="Hide">
        {I.close}
      </button>
    </div>
  );
}
