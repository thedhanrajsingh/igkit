import { getCampaignTemplateSlugs } from "@/lib/templates/campaign-templates";

export const SITE_NAME = "IGKit";
export const SITE_DESCRIPTION =
  "A free ManyChat and Linktree alternative. Auto-DM people who comment a keyword on your Instagram posts, reels or stories, and share all your links from one bio page. Open source and self-hosted.";
export const REPO_URL = "https://github.com/thedhanrajsingh/igkit";

// Public, indexable pages. Signed-in app routes are excluded in robots.ts.
export function publicPaths(): string[] {
  return [
    "/",
    "/manychat-alternative",
    "/comment-link-automation",
    "/instagram-comment-to-dm-templates",
    "/instagram-dm-automation-agencies",
    "/templates",
    ...getCampaignTemplateSlugs().map((slug) => `/templates/${slug}`),
    "/privacy",
    "/terms",
  ];
}
