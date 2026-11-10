import type { MetadataRoute } from "next";

// Lets the portal install on phones and computers like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Deal Portal",
    short_name: "Deals",
    description: "Auto-finance deals, from first call to closed.",
    start_url: "/deals",
    display: "standalone",
    background_color: "#F5F6F8",
    theme_color: "#3345D1",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
