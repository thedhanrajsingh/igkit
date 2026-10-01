import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { publicPaths } from "@/lib/seo";

// Built per request so newly published bio pages show up without a redeploy.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getBaseUrl();
  const bioPages = await prisma.bioPage
    .findMany({ where: { isPublished: true }, select: { handle: true, updatedAt: true } })
    .catch(() => []);

  return [
    ...publicPaths().map((path) => ({ url: `${base}${path === "/" ? "" : path}` })),
    ...bioPages.map((page) => ({ url: `${base}/${page.handle}`, lastModified: page.updatedAt })),
  ];
}
