import type { MetadataRoute } from "next";

// Makes a self-hosted instance installable to the home screen, opening standalone
// without browser chrome so checking campaigns from a phone is practical.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "IGKit",
    short_name: "IGKit",
    description: "Instagram comment-to-DM automation",
    start_url: "/overview",
    display: "standalone",
    orientation: "portrait",
    background_color: "#18181b",
    theme_color: "#18181b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
