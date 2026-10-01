import type { MetadataRoute } from "next";
import { getBaseUrl } from "@/lib/env";

const APP_ROUTES = [
  "/dashboard", "/overview", "/inbox", "/campaigns", "/automations", "/bio",
  "/logs", "/settings", "/diagnostics", "/login", "/verify-request",
];

// Search engines and AI crawlers are welcome on public pages; the app and API stay private.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // "$" stops "/bio" from also blocking a creator page like "/biology".
      disallow: [
        "/api/", "/invite/", "/reports/", "/r/", "/go/",
        ...APP_ROUTES.flatMap((route) => [`${route}$`, `${route}/`]),
      ],
    },
    sitemap: `${getBaseUrl()}/sitemap.xml`,
  };
}
