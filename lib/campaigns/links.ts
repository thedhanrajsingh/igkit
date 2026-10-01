import type { Prisma } from "@/app/generated/prisma/client";
import { TRACKED_LINK_ORDER } from "@/lib/tracking/link-order";
import { generateTrackedLinkSlug } from "@/lib/tracking/server";

// The primary button's title lives on the campaign (`linkButtonLabel`), so this
// label is a placeholder; later links store their title in `label`.
export const PRIMARY_LINK_LABEL = "Primary campaign link";
export const DEFAULT_LINK_BUTTON_LABEL = "Open link";

type LinkFields = {
  // For each URL: a URL sets the link, an empty string removes it, and null or
  // undefined leaves it untouched.
  primaryUrl?: string | null;
  secondaryUrl?: string | null;
  secondaryLabel?: string | null;
};

export function buildInitialCampaignLinks({
  workspaceId,
  primaryUrl,
  secondaryUrl,
  secondaryLabel,
}: LinkFields & { workspaceId: string }) {
  const links: {
    workspaceId: string;
    slug: string;
    label: string;
    destinationUrl: string;
  }[] = [];

  if (primaryUrl) {
    links.push({
      workspaceId,
      slug: generateTrackedLinkSlug(),
      label: PRIMARY_LINK_LABEL,
      destinationUrl: primaryUrl,
    });
  }
  if (secondaryUrl) {
    links.push({
      workspaceId,
      slug: generateTrackedLinkSlug(),
      label: secondaryLabel?.trim() || DEFAULT_LINK_BUTTON_LABEL,
      destinationUrl: secondaryUrl,
    });
  }

  return links.map((link, position) => ({ ...link, position }));
}

type StoredLink = { id: string; position: number };

// Read links once and target by id: re-reading after a write could swap tied
// rows. Call after the campaign update in one transaction, which serializes saves.
export async function syncCampaignLinks(
  tx: Prisma.TransactionClient,
  {
    workspaceId,
    automationId,
    primaryUrl,
    secondaryUrl,
    secondaryLabel,
  }: LinkFields & { workspaceId: string; automationId: string }
) {
  const primaryChanged = primaryUrl !== undefined && primaryUrl !== null;
  const secondaryChanged = secondaryUrl !== undefined && secondaryUrl !== null;
  if (!primaryChanged && !secondaryChanged) return;

  const [primary, secondary, ...rest] = await tx.trackedLink.findMany({
    where: { automationId },
    orderBy: TRACKED_LINK_ORDER,
    select: { id: true, position: true },
  });

  let first: StoredLink | undefined = primary;
  if (primaryChanged) {
    if (primaryUrl === "") {
      if (primary) {
        await tx.trackedLink.delete({ where: { id: primary.id } });
      }
      first = undefined;
    } else if (primary) {
      await tx.trackedLink.update({
        where: { id: primary.id },
        data: { destinationUrl: primaryUrl },
      });
    } else {
      first = await tx.trackedLink.create({
        data: {
          workspaceId,
          automationId,
          slug: generateTrackedLinkSlug(),
          label: PRIMARY_LINK_LABEL,
          destinationUrl: primaryUrl,
          position: 0,
        },
        select: { id: true, position: true },
      });
    }
  }

  let second: StoredLink | undefined = secondary;
  if (secondaryChanged) {
    const label = secondaryLabel?.trim() || DEFAULT_LINK_BUTTON_LABEL;

    if (secondaryUrl === "") {
      if (secondary) {
        await tx.trackedLink.delete({ where: { id: secondary.id } });
      }
      second = undefined;
    } else if (secondary) {
      await tx.trackedLink.update({
        where: { id: secondary.id },
        data: { destinationUrl: secondaryUrl, label },
      });
    } else {
      second = await tx.trackedLink.create({
        data: {
          workspaceId,
          automationId,
          slug: generateTrackedLinkSlug(),
          label,
          destinationUrl: secondaryUrl,
          position: first ? 1 : 0,
        },
        select: { id: true, position: true },
      });
    }
  }

  const ordered = [first, second, ...rest].filter(
    (link): link is StoredLink => link !== undefined
  );
  for (const [position, link] of ordered.entries()) {
    if (link.position !== position) {
      await tx.trackedLink.update({
        where: { id: link.id },
        data: { position },
      });
    }
  }
}
