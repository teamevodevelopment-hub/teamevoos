import type { MetadataRoute } from "next";

// Lets the portal install on phones and computers like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "easyAuto Deal Portal",
    short_name: "easyAuto",
    description: "Auto-finance deals, from first call to closed.",
    start_url: "/deals",
    display: "standalone",
    background_color: "#F5F6F8",
    theme_color: "#07172F",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
