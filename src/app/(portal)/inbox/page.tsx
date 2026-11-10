"use client";

import { useRouter } from "next/navigation";
import { usePortal } from "@/components/PortalProvider";
import { Avatar, Mentionized } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { when } from "@/lib/stages";

export default function InboxPage() {
  const { notifications, person, profiles, openDeal, refreshNotifications } = usePortal();
  const router = useRouter();
  const names = [...profiles.map((p) => p.name), "team", "everyone"];

  if (!notifications.length)
    return (
      <div className="inbox">
        <div className="emptystate">
          <h3>You’re all caught up</h3>
          When someone @mentions you or moves one of your deals, it shows up here.
        </div>
      </div>
    );

  async function readAll() {
    await supabase().from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    refreshNotifications();
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", maxWidth: 760, marginBottom: 10 }}>
        <button className="btn" onClick={readAll}>
          Mark all read
        </button>
      </div>
      <div className="inbox">
        {notifications.map((n) => (
          <button
            key={n.id}
            className={`ib${n.read_at ? "" : " unread"}`}
            onClick={async () => {
              if (!n.read_at) {
                await supabase().from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
                refreshNotifications();
              }
              if (!n.deal_id) router.push("/team");
              else if (n.deals) openDeal(n.deal_id);
            }}
          >
            <Avatar p={person(n.actor_id)} size="lg" />
            <div className="t">
              <div className="l1">
                <b>{person(n.actor_id)?.name ?? "Someone"}</b>
                <span>{n.kind === "mention" ? (n.deal_id ? "mentioned you on" : "mentioned you in") : "updated"}</span>
                <span className="deal">
                  {!n.deal_id ? "Team chat" : n.deals ? `${n.deals.first_name} ${n.deals.last_name}` : "a deal you can no longer see"}
                </span>
                <span className="when">{when(n.created_at)}</span>
              </div>
              <div className="q">
                <Mentionized text={n.body.replace(/#\[deal:\d+\]/g, "a deal")} names={names} />
              </div>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
