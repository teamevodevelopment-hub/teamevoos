"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePortal } from "@/components/PortalProvider";
import { I } from "@/components/ui";
import { supabase, errText } from "@/lib/supabase/client";

type Side = "front" | "back";

export default function NewDealPage() {
  const { me, profiles, toast, refreshDeals } = usePortal();
  const router = useRouter();
  const [form, setForm] = useState({ first: "", last: "", phone: "", email: "", city: "", dt: "", agent: "" });
  const [files, setFiles] = useState<Record<Side, File | null>>({ front: null, back: null });
  const [previews, setPreviews] = useState<Record<Side, string | null>>({ front: null, back: null });
  const [busy, setBusy] = useState(false);
  const pickAgent = me.role !== "agent";

  useEffect(() => {
    if (pickAgent && !form.agent) {
      const firstAgent = profiles.find((p) => p.role === "agent") ?? profiles[0];
      if (firstAgent) setForm((f) => ({ ...f, agent: firstAgent.id }));
    }
  }, [pickAgent, profiles, form.agent]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function pick(side: Side, file: File | undefined) {
    if (!file) return;
    setFiles((f) => ({ ...f, [side]: file }));
    setPreviews((p) => {
      if (p[side]) URL.revokeObjectURL(p[side]!);
      return { ...p, [side]: file.type.startsWith("image/") ? URL.createObjectURL(file) : null };
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const sb = supabase();
    const { data, error } = await sb
      .from("deals")
      .insert({
        first_name: form.first.trim(),
        last_name: form.last.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        city: form.city.trim() || null,
        dealertrack_no: form.dt.trim() || null,
        agent_id: pickAgent ? form.agent : me.id,
      })
      .select("id")
      .single();
    if (error || !data) {
      setBusy(false);
      return toast(errText(error), "warn");
    }
    const id = data.id as number;
    const paths: Partial<Record<"licence_front" | "licence_back", string>> = {};
    for (const side of ["front", "back"] as Side[]) {
      const f = files[side];
      if (!f) continue;
      const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
      const key = `${id}/${side}-${Date.now()}.${ext}`;
      const up = await sb.storage.from("licences").upload(key, f, { contentType: f.type || undefined });
      if (up.error) toast(`Licence ${side} didn’t upload: ${errText(up.error)}. Add it from the deal.`, "warn");
      else paths[side === "front" ? "licence_front" : "licence_back"] = key;
    }
    if (paths.licence_front || paths.licence_back) await sb.from("deals").update(paths).eq("id", id);
    if (paths.licence_front && paths.licence_back) await sb.rpc("move_deal", { p_deal: id, p_to: "docs", p_reason: null });
    await refreshDeals();
    toast(`${form.first.trim()} ${form.last.trim()} added`, "ok");
    router.push(`/deals?deal=${id}`);
  }

  const slot = (side: Side) => (
    <label className={`drop${files[side] ? " has" : ""}`}>
      {previews[side] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previews[side]!} alt={`Licence ${side} preview`} />
      ) : files[side] ? (
        <>
          <b>{files[side]!.name}</b>
          <span>Attached</span>
        </>
      ) : (
        <>
          {I.camera}
          <b>Licence {side}</b>
          <span>Take a photo or drop a file</span>
        </>
      )}
      <input type="file" accept="image/*,application/pdf" capture="environment" aria-label={`Licence ${side}`} onChange={(e) => pick(side, e.target.files?.[0])} />
    </label>
  );

  return (
    <form className="formcard" onSubmit={submit} autoComplete="off">
      <div>
        <h2>New deal</h2>
        <p className="lead">Add the customer and their licence. You can fill in the rest later.</p>
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="nf-first">First name</label>
          <input className="input" id="nf-first" required value={form.first} onChange={set("first")} placeholder="e.g. Maya" />
        </div>
        <div className="field">
          <label htmlFor="nf-last">Last name</label>
          <input className="input" id="nf-last" required value={form.last} onChange={set("last")} placeholder="e.g. Chen" />
        </div>
        <div className="field">
          <label htmlFor="nf-phone">Phone</label>
          <input className="input" id="nf-phone" type="tel" value={form.phone} onChange={set("phone")} placeholder="(416) 555-0100" />
        </div>
        <div className="field">
          <label htmlFor="nf-email">Email</label>
          <input className="input" id="nf-email" type="email" value={form.email} onChange={set("email")} placeholder="name@example.com" />
        </div>
        <div className="field">
          <label htmlFor="nf-city">City</label>
          <input className="input" id="nf-city" value={form.city} onChange={set("city")} placeholder="Toronto, ON" />
        </div>
        {pickAgent ? (
          <div className="field">
            <label htmlFor="nf-agent">Assigned to</label>
            <select className="input" id="nf-agent" value={form.agent} onChange={set("agent")}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="nf-dt">
            Dealertrack application # <span style={{ fontWeight: 400, color: "var(--fg-3)" }}>(optional)</span>
          </label>
          <input className="input mono" id="nf-dt" value={form.dt} onChange={set("dt")} placeholder="DT-00000000" />
        </div>
      </div>
      <div className="field">
        <span className="flabel">
          Driver’s licence <span style={{ fontWeight: 400, color: "var(--fg-3)" }}>(optional, front and back)</span>
        </span>
        <div className="drops">
          {slot("front")}
          {slot("back")}
        </div>
      </div>
      <div className="formfoot">
        <span className="note">
          {I.lock}Stored privately in Canada
        </span>
        <button type="button" className="btn" onClick={() => router.push("/deals")}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy}>
          {busy ? "Saving…" : "Create deal"}
        </button>
      </div>
    </form>
  );
}
