// Deal Portal background worker: shows push notifications and opens the right chat when one is tapped.
// No offline caching: the app always loads fresh from the server.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { body: event.data ? event.data.text() : "" };
  }
  const shown = self.registration.showNotification(d.title || "Deal Portal", {
    body: d.body || "",
    icon: "/icons/192",
    badge: "/icons/96",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || "/deals" },
  });
  const nav = self.navigator;
  const badge =
    typeof d.badge === "number" && nav && "setAppBadge" in nav
      ? (d.badge > 0 ? nav.setAppBadge(d.badge) : nav.clearAppBadge()).catch(() => {})
      : Promise.resolve();
  event.waitUntil(Promise.all([shown, badge]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/deals", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const app = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (app) {
        // The open app switches screens itself, so nothing reloads.
        app.postMessage({ type: "open", url });
        return app.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});
