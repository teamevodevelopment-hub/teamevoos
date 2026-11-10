"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { supabase, errText } from "@/lib/supabase/client";
import { STAGE, targets, FINAL } from "@/lib/stages";
import type { Deal, NamedRow, Notification, Profile, StageId, TeamMessage } from "@/lib/types";

export type Dialog =
  | { kind: "lost"; deal: Deal }
  | { kind: "lenders"; deal: Deal }
  | { kind: "idea" }
  | { kind: "palette" }
  | null;

interface Toast {
  id: number;
  msg: string;
  kind: "" | "ok" | "warn";
}

interface Portal {
  me: Profile;
  profiles: Profile[];
  person: (id: string | null | undefined) => Profile | undefined;
  deals: Deal[];
  notifications: Notification[];
  lenders: NamedRow[];
  lostReasons: NamedRow[];
  dealsLoaded: boolean;
  layout: "board" | "table";
  setLayout: (l: "board" | "table") => void;
  flash: number | null;
  refreshDeals: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  toast: (msg: string, kind?: Toast["kind"]) => void;
  openDeal: (id: number) => void;
  closeDeal: () => void;
  tryMove: (d: Deal, to: StageId) => void;
  move: (d: Deal, to: StageId, reason?: string) => Promise<boolean>;
  dialog: Dialog;
  setDialog: (d: Dialog) => void;
  toasts: Toast[];
  unread: number;
  teamUnread: number;
  markTeamSeen: (lastId: number) => void;
  confetti: number;
  celebrate: () => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Portal | null>(null);

export function usePortal() {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePortal must be used inside PortalProvider");
  return c;
}

function denyReason(d: Deal, to: StageId, me: Profile) {
  if (d.stage === "closed" || d.stage === "declined") return `${STAGE[d.stage].name} deals are final.`;
  if (d.stage === "lost") return "Only Sam or TJ can reopen a lost deal.";
  if (to === "lost") return "Only Sam can mark a deal lost.";
  if (to === "submitted") return "Only TJ submits deals to lenders.";
  const later: StageId[] = ["submitted", "approved", "car", "closed", "declined"];
  if (later.includes(to) && me.role === "agent") return "Only TJ or Sam can move deals past Ready to submit.";
  if (later.includes(d.stage) && ["new", "docs", "ready"].includes(to)) return "A deal can’t go back once it’s with lenders.";
  return `Can’t move from ${STAGE[d.stage].name} straight to ${STAGE[to].name}.`;
}

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Profile | null>(null);
  const [problem, setProblem] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealsLoaded, setDealsLoaded] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [lenders, setLenders] = useState<NamedRow[]>([]);
  const [lostReasons, setLostReasons] = useState<NamedRow[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [flash, setFlash] = useState<number | null>(null);
  const [layout, setLayoutState] = useState<"board" | "table">("board");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toastId = useRef(0);
  const profilesRef = useRef<Profile[]>([]);
  profilesRef.current = profiles;
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const [teamUnread, setTeamUnread] = useState(0);
  const [confetti, setConfetti] = useState(0);
  const celebrate = useCallback(() => setConfetti((n) => n + 1), []);

  // The team room remembers the last message each person has seen (on this device).
  const markTeamSeen = useCallback((lastId: number) => {
    try {
      const prev = Number(localStorage.getItem("teamSeen") || 0);
      if (lastId > prev) localStorage.setItem("teamSeen", String(lastId));
    } catch {}
    setTeamUnread(0);
  }, []);

  const toast = useCallback((msg: string, kind: Toast["kind"] = "") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  const refreshDeals = useCallback(async () => {
    const { data, error } = await supabase()
      .from("deals")
      .select("*, lender_submissions(*)")
      .order("stage_changed_at", { ascending: false });
    if (error) return toast(errText(error), "warn");
    setDeals((data ?? []) as Deal[]);
    setDealsLoaded(true);
  }, [toast]);

  const refreshNotifications = useCallback(async () => {
    const { data } = await supabase()
      .from("notifications")
      .select("*, deals(first_name,last_name)")
      .order("created_at", { ascending: false })
      .limit(200);
    setNotifications((data ?? []) as Notification[]);
  }, []);

  const refreshSettings = useCallback(async () => {
    const sb = supabase();
    const [l, r, p] = await Promise.all([
      sb.from("lenders").select("*").order("name"),
      sb.from("lost_reasons").select("*").order("id"),
      sb.from("profiles").select("id,name,role").order("name"),
    ]);
    setLenders((l.data ?? []) as NamedRow[]);
    setLostReasons((r.data ?? []) as NamedRow[]);
    setProfiles((p.data ?? []) as Profile[]);
  }, []);

  // Who am I?
  useEffect(() => {
    (async () => {
      const sb = supabase();
      const { data } = await sb.auth.getUser();
      if (!data.user) return void (window.location.href = "/login");
      const { data: prof } = await sb.from("profiles").select("id,name,role").eq("id", data.user.id).maybeSingle();
      if (!prof) return setProblem("Your account isn’t set up yet. Ask TJ to add you to the team.");
      setMe(prof as Profile);
    })();
    try {
      const saved = localStorage.getItem("layout");
      if (saved === "table" || saved === "board") setLayoutState(saved);
    } catch {}
  }, []);

  // Load everything, then stay live.
  useEffect(() => {
    if (!me) return;
    refreshDeals();
    refreshNotifications();
    refreshSettings();
    (async () => {
      let seen = 0;
      try {
        seen = Number(localStorage.getItem("teamSeen") || 0);
      } catch {}
      const sb = supabase();
      if (!seen) {
        // First visit on this device: start fresh rather than flag the whole history as unread.
        const { data } = await sb.from("team_messages").select("id").order("id", { ascending: false }).limit(1);
        if (data?.[0]) markTeamSeen(data[0].id as number);
        return;
      }
      const { count } = await sb
        .from("team_messages")
        .select("id", { count: "exact", head: true })
        .gt("id", seen)
        .neq("author_id", me.id);
      setTeamUnread(count ?? 0);
    })();
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(t);
      t = setTimeout(refreshDeals, 250);
    };
    const ch = supabase()
      .channel("portal")
      .on("postgres_changes", { event: "*", schema: "public", table: "deals" }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "lender_submissions" }, soon)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "team_messages" }, (x) => {
        const m = x.new as TeamMessage;
        const onTeam = pathRef.current === "/team";
        if (m.kind === "celebration") {
          celebrate();
          if (!onTeam) {
            const who = profilesRef.current.find((p) => p.id === m.author_id)?.name ?? "Someone";
            toast(m.body === "closed" ? `🎉 ${who} just closed a deal!` : `✅ ${who}’s deal got approved!`, "ok");
          }
        }
        if (!onTeam && m.author_id !== me.id) setTeamUnread((n) => n + 1);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${me.id}` }, (p) => {
        refreshNotifications();
        if (p.eventType === "INSERT") {
          const n = p.new as Notification;
          if (!n.read_at) {
            const who = profilesRef.current.find((x) => x.id === n.actor_id)?.name ?? "Someone";
            toast(n.kind === "mention" ? `${who} mentioned you` : n.body);
          }
        }
      })
      .subscribe();
    const onFocus = () => {
      refreshDeals();
      refreshNotifications();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(t);
      window.removeEventListener("focus", onFocus);
      supabase().removeChannel(ch);
    };
  }, [me, refreshDeals, refreshNotifications, refreshSettings, toast, celebrate, markTeamSeen]);

  const person = useCallback((id: string | null | undefined) => profiles.find((p) => p.id === id), [profiles]);

  const openDeal = useCallback(
    (id: number) => {
      const q = new URLSearchParams(params.toString());
      q.set("deal", String(id));
      router.push(`${pathname}?${q.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );
  const closeDeal = useCallback(() => {
    const q = new URLSearchParams(params.toString());
    q.delete("deal");
    const s = q.toString();
    router.push(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  const move = useCallback(
    async (d: Deal, to: StageId, reason?: string) => {
      const { error } = await supabase().rpc("move_deal", { p_deal: d.id, p_to: to, p_reason: reason ?? null });
      if (error) {
        toast(errText(error), "warn");
        return false;
      }
      toast(`${d.first_name} ${d.last_name} → ${STAGE[to].name}`, "ok");
      setFlash(d.id);
      setTimeout(() => setFlash(null), 1300);
      await refreshDeals();
      return true;
    },
    [refreshDeals, toast],
  );

  const tryMove = useCallback(
    (d: Deal, to: StageId) => {
      if (!me || to === d.stage) return;
      const t = targets(d, me).find((x) => x.to === to);
      if (!t) return toast(denyReason(d, to, me), "warn");
      if (to === "lost") return setDialog({ kind: "lost", deal: d });
      if (to === "submitted") return setDialog({ kind: "lenders", deal: d });
      void move(d, to);
    },
    [me, move, toast],
  );

  const setLayout = useCallback((l: "board" | "table") => {
    setLayoutState(l);
    try {
      localStorage.setItem("layout", l);
    } catch {}
  }, []);

  const signOut = useCallback(async () => {
    await supabase().auth.signOut();
    window.location.href = "/login";
  }, []);

  const unread = useMemo(() => notifications.filter((n) => !n.read_at).length, [notifications]);

  if (problem)
    return (
      <main className="auth">
        <div className="authcard">
          <h1>Almost there</h1>
          <p>{problem}</p>
          <button className="btn" onClick={signOut}>Sign out</button>
        </div>
      </main>
    );
  if (!me) return <div className="loadingshell">Loading…</div>;

  const value: Portal = {
    me,
    profiles,
    person,
    deals,
    notifications,
    lenders,
    lostReasons,
    dealsLoaded,
    layout,
    setLayout,
    flash,
    refreshDeals,
    refreshNotifications,
    refreshSettings,
    toast,
    openDeal,
    closeDeal,
    tryMove,
    move,
    dialog,
    setDialog,
    toasts,
    unread,
    teamUnread,
    markTeamSeen,
    confetti,
    celebrate,
    signOut,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const isOpen = (d: Deal) => !FINAL.includes(d.stage);
