"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { usePortal, isOpen } from "./PortalProvider";
import { Avatar, I } from "./ui";
import { ROLE_TITLE } from "@/lib/stages";
import { DealPanel } from "./DealPanel";
import { Dialogs } from "./Dialogs";
import { Confetti } from "./Confetti";
import { PushBanner } from "./PushBanner";
import { WinCard } from "./Showroom";

export function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const q = matchMedia("(max-width: 860px)");
    const on = () => setM(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return m;
}

const TITLES: Record<string, string> = { "/deals": "Deals", "/team": "Team room", "/chats": "Chats", "/inbox": "Inbox", "/new": "New deal", "/paystub": "Paystub verifier", "/settings": "Settings" };
// Non-admins reach /settings only for their account (sign out), so it gets a plainer name.
const titleFor = (path: string, admin: boolean) => (path === "/settings" && !admin ? "Account" : (TITLES[path] ?? "Deal Portal"));

export function Shell({ children }: { children: React.ReactNode }) {
  const p = usePortal();
  const { me, deals, unread, chatsUnread, confetti, layout, setLayout, setDialog, dialog, toasts, closeDeal, person } = p;
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = Number(params.get("deal")) || null;

  const nav = [
    { href: "/deals", label: "Deals", icon: I.board },
    { href: "/chats", label: "Chats", icon: I.team, count: chatsUnread, match: ["/chats", "/team"] },
    { href: "/inbox", label: "Inbox", icon: I.inbox, count: unread },
    { href: "/new", label: "New deal", icon: I.plus },
    { href: "/paystub", label: "Paystub verifier", short: "Paystub", icon: I.stub },
    ...(me.role === "admin" ? [{ href: "/settings", label: "Settings", icon: I.gear }] : []),
  ];

  // Computers: the sidebar can shrink to icons for more board space. Remembered per device.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("sideCollapsed") === "1");
    } catch {}
  }, []);
  const toggleSide = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem("sideCollapsed", c ? "0" : "1");
      } catch {}
      return !c;
    });

  // ⌘\ (Ctrl+\ on Windows) collapses or expands the sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setCollapsed((c) => {
          try {
            localStorage.setItem("sideCollapsed", c ? "0" : "1");
          } catch {}
          return !c;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Pull down on a list (phone) to refresh it.
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullStart = useRef<{ x: number; y: number } | null>(null);
  const PULL_AT = 72;
  const onPullStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const v = e.currentTarget;
    if (refreshing || v.scrollTop > 0 || v.querySelector(".convo, .team")) return;
    pullStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onPullMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const s = pullStart.current;
    if (!s) return;
    const dy = e.touches[0].clientY - s.y;
    const dx = Math.abs(e.touches[0].clientX - s.x);
    if (dy <= 0 || dx > dy) {
      setPull(0);
      if (dx > 12) pullStart.current = null;
      return;
    }
    setPull(Math.min(110, dy * 0.5));
  };
  const onPullEnd = async () => {
    const went = pull;
    pullStart.current = null;
    setPull(0);
    if (went < PULL_AT * 0.7) return;
    setRefreshing(true);
    window.dispatchEvent(new Event("app:refresh"));
    await Promise.all([p.refreshDeals(), p.refreshNotifications()]).catch(() => {});
    setTimeout(() => setRefreshing(false), 400);
  };

  const here = (n: { href: string; match?: string[] }) => (n.match ?? [n.href]).some((m) => pathname === m || pathname.startsWith(m + "/"));
  const dmWith = pathname.startsWith("/chats/") ? person(pathname.slice(7)) : undefined;

  // iPhones don't shrink the page when the keyboard opens. Size the app to the visible area instead,
  // so the message box sits right above the keyboard, like WhatsApp.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const fit = () => {
      document.documentElement.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
      if (window.scrollY) window.scrollTo(0, 0);
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDialog({ kind: "palette" });
      } else if (e.key === "Escape") {
        if (dialog) setDialog(null);
        else if (openId) closeDeal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, openId, setDialog, closeDeal]);

  const active = deals.filter(isOpen).length;
  const sub =
    pathname === "/deals"
      ? me.role === "agent"
        ? `Your ${active} active deal${active === 1 ? "" : "s"}`
        : `${active} active deal${active === 1 ? "" : "s"} across the team`
      : pathname === "/team"
        ? "Everyone on the team · type @team to ping all"
        : pathname === "/chats"
          ? "Team room and private chats"
          : dmWith
            ? "Private chat"
        : pathname === "/inbox"
        ? `${unread} unread`
        : pathname === "/new"
          ? "Takes about a minute"
          : pathname === "/paystub"
            ? "Upload a pay stub to see income and time at the job"
          : me.role === "admin"
            ? "Team settings and your account"
            : "Your account";

  return (
    <>
      <div className={`app${collapsed ? " collapsed" : ""}`}>
        <aside className="side">
          <div className="brand">
            {/* The sidebar is always dark, so it uses the white version of the logo. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-full" src="/brand/logo-dark.png" alt="easyAuto" width={164} height={52} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-mark" src="/icons/icon-96.png" alt="easyAuto" width={36} height={36} />
            <span className="brand-sub">Deal portal</span>
          </div>
          <button className="side-toggle" onClick={toggleSide} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {I.back}
          </button>
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="nav" aria-current={here(n) ? "page" : undefined} title={collapsed ? n.label : undefined}>
              {n.icon}
              <span className="nav-l">{n.label}</span>
              {n.count ? (
                <span className="count" key={n.count}>
                  {n.count}
                </span>
              ) : null}
            </Link>
          ))}
          <div className="grow" />
          <button className="suggest" onClick={() => setDialog({ kind: "idea" })} title={collapsed ? "Suggest a feature" : undefined}>
            {I.bulb}
            <span>Suggest a feature</span>
          </button>
          <div className="me">
            <Avatar p={me} size="lg" />
            <div>
              <b>{me.name}</b>
              <small>{ROLE_TITLE[me.role]}</small>
            </div>
            <button className="signout" onClick={p.signOut}>
              Sign out
            </button>
          </div>
        </aside>
        <main className="main">
          <header className="top">
            <h1>{dmWith ? dmWith.name : titleFor(pathname, me.role === "admin")}</h1>
            <span className="sub">{sub}</span>
            <span className="sp" />
            <button className="searchbtn" onClick={() => setDialog({ kind: "palette" })}>
              {I.search}
              <span>Find a customer</span>
              <kbd>⌘K</kbd>
            </button>
            {pathname === "/deals" && (
              <span className="seg layout" role="group" aria-label="Layout">
                <button aria-pressed={layout === "board"} onClick={() => setLayout("board")}>
                  Board
                </button>
                <button aria-pressed={layout === "table"} onClick={() => setLayout("table")}>
                  Table
                </button>
              </span>
            )}
            <Link className="btn primary newbtn" href="/new">
              {I.plus}New deal
            </Link>
            <span className="mtop">
              <button className="iconbtn" onClick={() => setDialog({ kind: "palette" })} aria-label="Search">
                {I.search}
              </button>
              <Link className="iconbtn" href="/settings" aria-label="Account" style={{ display: "grid" }}>
                <Avatar p={me} size="sm" />
              </Link>
            </span>
          </header>
          {/* The notifications ask lives on Deals only, so it doesn't follow you around. */}
          {pathname === "/deals" && <PushBanner />}
          {/* Keyed by screen so each one fades up into place. */}
          <div className="ptr" aria-hidden style={{ height: refreshing ? 44 : pull, opacity: refreshing || pull > 8 ? 1 : 0 }}>
            <span className={`ptr-ic${refreshing ? " spin-on" : ""}`} style={{ transform: refreshing ? undefined : `rotate(${pull * 4}deg)` }}>
              {I.refresh}
            </span>
          </div>
          <div className="view" key={pathname} onTouchStart={onPullStart} onTouchMove={onPullMove} onTouchEnd={onPullEnd}>
            {children}
          </div>
        </main>
      </div>

      <nav className="tabbar" aria-label="Main">
        {nav
          .filter((n) => n.href !== "/settings")
          .map((n) =>
            n.href === "/new" ? (
              <Link key={n.href} href={n.href} className="tab new" aria-current={pathname === n.href ? "page" : undefined}>
                <span className="plus">{I.plus}</span>New
              </Link>
            ) : (
              <Link key={n.href} href={n.href} className="tab" aria-current={here(n) ? "page" : undefined}>
                {n.icon}
                {"short" in n && n.short ? n.short : n.label}
                {"count" in n && n.count ? (
                  <span className="count" key={n.count}>
                    {n.count}
                  </span>
                ) : null}
              </Link>
            ),
          )}
      </nav>

      <div className={`scrim${openId ? " on" : ""}`} onClick={closeDeal} />
      <DealPanel id={openId} />
      <Dialogs />
      <Confetti fire={confetti} />
      <WinCard />
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </>
  );
}
