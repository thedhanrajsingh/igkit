import { getBaseUrl } from "@/lib/env";
import { REPO_URL, SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo";

// llms.txt (llmstxt.org): a plain summary of the product for AI agents and assistants.
export function GET() {
  const base = getBaseUrl();
  const body = `# ${SITE_NAME}

> ${SITE_DESCRIPTION}

${SITE_NAME} is MIT licensed and self-hosted: each owner deploys their own copy (Next.js, PostgreSQL, Redis, a worker) and connects Instagram through the official Meta API or the optional paid provider Zernio. There is no hosted plan.

## Features
- Keyword comment to DM: a comment matching a campaign keyword triggers an Instagram private reply, optionally with a public comment reply.
- DM and story reply triggers: the same keywords can fire on inbound DMs.
- Follow gate: optionally require a follow before the link is sent.
- Tracked links with click and CTR stats, up to two link buttons per DM.
- Bio page: a Linktree-style link-in-bio page at /<handle> with click counts.
- Inbox, DM logs, multiple Instagram accounts, workspaces with owner, admin and member roles.
- Rate limiting under Meta's 750 private replies per hour, English and Traditional Chinese UI.

## Pages
- [Home](${base}/): overview of ${SITE_NAME}
- [ManyChat alternative](${base}/manychat-alternative): how ${SITE_NAME} compares to chatbot builders
- [Comment link automation](${base}/comment-link-automation): sending links from comments
- [Comment-to-DM templates](${base}/instagram-comment-to-dm-templates): ready campaign templates
- [For agencies](${base}/instagram-dm-automation-agencies): running campaigns for clients
- [Templates](${base}/templates): template library

## Source
- [GitHub repository](${REPO_URL}): code, setup guide and docs
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
