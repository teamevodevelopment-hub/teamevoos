"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { supabase, errText } from "@/lib/supabase/client";
import { STAGE, targets, FINAL } from "@/lib/stages";
import { previewText } from "@/lib/chatFiles";
import { registerServiceWorker, resyncPush, disablePush, setBadge } from "@/lib/push";
import type { ChatRead, Deal, DirectMessage, NamedRow, Notification, Profile, StageId, TeamMessage } from "@/lib/types";

export type Dialog =
  | { kind: "lost"; deal: Deal }
  | { kind: "lenders"; deal: Deal }
  | { kind: "idea" }
  | { kind: "palette" }
  | null;

export interface Win {
  kind: "closed" | "approved";
  agentId: string | null;
  dealId: number | null;
  at: number;
}

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
  /** Unread message counts per chat: "team", "deal:<id>", "dm:<person id>". */
  unreadChats: Record<string, number>;
  /** Chats with something unread in Chats (team room + private chats). */
  chatsUnread: number;
  markRead: (chat: string) => void;
  /** When each person last read each chat (for ✓✓ and "Seen by"). */
  reads: ChatRead[];
  online: string[];
  muteTeam: boolean;
  setMuteTeam: (on: boolean) => Promise<void>;
  confetti: number;
  celebrate: () => void;
  /** The latest approval or closing, shown as a celebration card. */
  win: Win | null;
  clearWin: () => void;
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
  const [confetti, setConfetti] = useState(0);
  const celebrate = useCallback(() => setConfetti((n) => n + 1), []);
  const [win, setWin] = useState<Win | null>(null);
  const clearWin = useCallback(() => setWin(null), []);
  const [unreadChats, setUnreadChats] = useState<Record<string, number>>({});
  const [updatesUnread, setUpdatesUnread] = useState(0);
  const [reads, setReads] = useState<ChatRead[]>([]);
  const [online, setOnline] = useState<string[]>([]);
  const [muteTeam, setMuteTeamState] = useState(false);

  const refreshUnread = useCallback(async () => {
    const { data } = await supabase().rpc("my_unread");
    const u = (data ?? {}) as { chats?: Record<string, number>; updates?: number };
    setUnreadChats(u.chats ?? {});
    setUpdatesUnread(u.updates ?? 0);
  }, []);
  const unreadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const unreadSoon = useCallback(() => {
    clearTimeout(unreadTimer.current);
    unreadTimer.current = setTimeout(refreshUnread, 300);
  }, [refreshUnread]);

  const refreshReads = useCallback(async () => {
    const { data } = await supabase().from("chat_reads").select("user_id,chat,last_read_at");
    setReads((data ?? []) as ChatRead[]);
  }, []);

  // Marks a chat read now. Cleared on screen straight away; the server keeps the receipt.
  const readTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const markRead = useCallback((chat: string) => {
    setUnreadChats((u) => {
      if (!(chat in u)) return u;
      const next = { ...u };
      delete next[chat];
      return next;
    });
    clearTimeout(readTimers.current[chat]);
    readTimers.current[chat] = setTimeout(() => {
      supabase().rpc("mark_read", { p_chat: chat }).then(() => unreadSoon());
    }, 400);
  }, [unreadSoon]);

  const toast = useCallback((msg: string, kind: Toast["kind"] = "") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  const refreshDeals = useCallback(async () => {
    const { data, error } = await supabase()
      .from("deals")
      .select("*, lender_submissions(*), deal_conditions(*)")
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
    refreshUnread();
    refreshReads();
    supabase()
      .from("user_prefs")
      .select("mute_team")
      .maybeSingle()
      .then(({ data }) => setMuteTeamState(!!data?.mute_team));
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(t);
      t = setTimeout(refreshDeals, 250);
    };
    const ch = supabase()
      .channel("portal")
      .on("postgres_changes", { event: "*", schema: "public", table: "deals" }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "lender_submissions" }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "deal_conditions" }, soon)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "team_messages" }, (x) => {
        const m = x.new as TeamMessage;
        const onTeam = pathRef.current === "/team";
        if (m.kind === "celebration") {
          celebrate();
          // A card shows who won and what; it stays quiet inside the team room, where the post itself shows.
          if (!onTeam) setWin({ kind: m.body === "closed" ? "closed" : "approved", agentId: m.author_id, dealId: m.deal_id, at: Date.now() });
        }
        if (m.author_id !== me.id) unreadSoon();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (x) => {
        if ((x.new as { author_id: string | null }).author_id !== me.id) unreadSoon();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "direct_messages" }, (x) => {
        const m = x.new as DirectMessage;
        if (m.recipient_id !== me.id) return;
        unreadSoon();
        if (pathRef.current !== `/chats/${m.sender_id}`) {
          const who = profilesRef.current.find((p) => p.id === m.sender_id)?.name ?? "Someone";
          toast(`${who}: ${previewText(m)}`);
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_reads" }, (x) => {
        const r = x.new as ChatRead;
        if (!r?.chat) return;
        setReads((list) => [...list.filter((y) => !(y.user_id === r.user_id && y.chat === r.chat)), r]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${me.id}` }, (p) => {
        refreshNotifications();
        unreadSoon();
        if (p.eventType === "INSERT") {
          const n = p.new as Notification;
          if (!n.read_at) {
            const who = profilesRef.current.find((x) => x.id === n.actor_id)?.name ?? "Someone";
            toast(n.kind === "mention" ? `${who} mentioned you` : n.body);
          }
        }
      })
      .subscribe();
    // Who's online, across the whole app.
    const pres = supabase().channel("online", { config: { presence: { key: me.id } } });
    pres
      .on("presence", { event: "sync" }, () => setOnline(Object.keys(pres.presenceState())))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") pres.track({ at: Date.now() });
      });
    const onFocus = () => {
      refreshDeals();
      refreshNotifications();
      refreshUnread();
      refreshReads();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(t);
      window.removeEventListener("focus", onFocus);
      supabase().removeChannel(ch);
      supabase().removeChannel(pres);
    };
  }, [me, refreshDeals, refreshNotifications, refreshSettings, toast, celebrate, refreshUnread, refreshReads, unreadSoon]);

  // Phone app: background worker for notifications; tapping a notification opens the right screen.
  useEffect(() => {
    if (!me) return;
    registerServiceWorker().then(() => resyncPush());
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string };
      if (d?.type === "open" && d.url) {
        const u = new URL(d.url, location.origin);
        router.push(u.pathname + u.search);
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, [me, router]);

  // Tell the server which chat is open, so nobody gets pinged about what they're already reading.
  const dealParam = params.get("deal");
  const activeChat =
    pathname === "/team" ? "team" : pathname.startsWith("/chats/") ? `dm:${pathname.slice(7)}` : dealParam ? `deal:${dealParam}` : null;
  useEffect(() => {
    if (!me) return;
    const beat = () => {
      const visible = document.visibilityState === "visible";
      supabase()
        .from("user_prefs")
        .upsert({ user_id: me.id, active_chat: visible ? activeChat : null, active_at: new Date().toISOString() })
        .then(() => {});
    };
    beat();
    const t = setInterval(beat, 20_000);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [me, activeChat]);

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
    // This phone stops getting the person's notifications.
    await disablePush();
    setBadge(0);
    await supabase().auth.signOut();
    window.location.href = "/login";
  }, []);

  const unread = useMemo(() => notifications.filter((n) => !n.read_at).length, [notifications]);
  const teamUnread = unreadChats.team ?? 0;
  const chatsUnread = Object.keys(unreadChats).filter((k) => k === "team" || k.startsWith("dm:")).length;

  // The red number on the home-screen icon: chats with something unread, like WhatsApp.
  useEffect(() => {
    const dealsWithUpdates = new Set(notifications.filter((n) => !n.read_at && n.kind === "update" && n.deal_id).map((n) => `deal:${n.deal_id}`));
    setBadge(new Set([...Object.keys(unreadChats), ...dealsWithUpdates]).size);
  }, [unreadChats, notifications, updatesUnread]);

  const setMuteTeam = useCallback(
    async (on: boolean) => {
      if (!me) return;
      setMuteTeamState(on);
      const { error } = await supabase().from("user_prefs").upsert({ user_id: me.id, mute_team: on });
      if (error) {
        setMuteTeamState(!on);
        toast(errText(error), "warn");
      }
    },
    [me, toast],
  );

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
    unreadChats,
    chatsUnread,
    markRead,
    reads,
    online,
    muteTeam,
    setMuteTeam,
    confetti,
    celebrate,
    win,
    clearWin,
    signOut,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const isOpen = (d: Deal) => !FINAL.includes(d.stage);
