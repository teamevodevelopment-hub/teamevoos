"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { usePortal, isOpen } from "./PortalProvider";
import { Avatar, I } from "./ui";
import { ROLE_TITLE } from "@/lib/stages";
import { DealPanel } from "./DealPanel";
import { Dialogs } from "./Dialogs";

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

const TITLES: Record<string, string> = { "/deals": "Deals", "/inbox": "Inbox", "/new": "New deal", "/settings": "Settings" };
// Non-admins reach /settings only for their account (sign out), so it gets a plainer name.
const titleFor = (path: string, admin: boolean) => (path === "/settings" && !admin ? "Account" : (TITLES[path] ?? "Deal Portal"));

export function Shell({ children }: { children: React.ReactNode }) {
  const p = usePortal();
  const { me, deals, unread, layout, setLayout, setDialog, dialog, toasts, closeDeal } = p;
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = Number(params.get("deal")) || null;

  const nav = [
    { href: "/deals", label: "Deals", icon: I.board },
    { href: "/inbox", label: "Inbox", icon: I.inbox, count: unread },
    { href: "/new", label: "New deal", icon: I.plus },
    ...(me.role === "admin" ? [{ href: "/settings", label: "Settings", icon: I.gear }] : []),
  ];

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
      : pathname === "/inbox"
        ? `${unread} unread`
        : pathname === "/new"
          ? "Takes about a minute"
          : me.role === "admin"
            ? "Team settings and your account"
            : "Your account";

  return (
    <>
      <div className="app">
        <aside className="side">
          <div className="brand">
            <span className="mark">{I.logo}</span>Deal Portal
          </div>
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="nav" aria-current={pathname === n.href ? "page" : undefined}>
              {n.icon}
              {n.label}
              {n.count ? <span className="count">{n.count}</span> : null}
            </Link>
          ))}
          <div className="grow" />
          <button className="suggest" onClick={() => setDialog({ kind: "idea" })}>
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
            <h1>{titleFor(pathname, me.role === "admin")}</h1>
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
          <div className="view">{children}</div>
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
              <Link key={n.href} href={n.href} className="tab" aria-current={pathname === n.href ? "page" : undefined}>
                {n.icon}
                {n.label}
                {n.count ? <span className="count">{n.count}</span> : null}
              </Link>
            ),
          )}
      </nav>

      <div className={`scrim${openId ? " on" : ""}`} onClick={closeDeal} />
      <DealPanel id={openId} />
      <Dialogs />
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
