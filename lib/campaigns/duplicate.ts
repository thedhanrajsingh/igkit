import { prisma } from "@/lib/db/client";
import { generateReportShareSlug } from "@/lib/reports/share";
import { TRACKED_LINK_ORDER } from "@/lib/tracking/link-order";
import { generateTrackedLinkSlug } from "@/lib/tracking/server";

// Matches the campaign name limit the create and update schemas enforce.
const MAX_NAME_LENGTH = 100;
const COPY_SUFFIX = " copy";

// The suffix always survives: a full-length name is trimmed to make room.
export function buildDuplicateName(name: string): string {
  const suffixed = `${name}${COPY_SUFFIX}`;
  if (suffixed.length <= MAX_NAME_LENGTH) return suffixed;

  const trimmed = name.slice(0, MAX_NAME_LENGTH - COPY_SUFFIX.length).trimEnd();
  return `${trimmed}${COPY_SUFFIX}`;
}

// Built from the stored row so fields added later are copied too. The copy
// starts paused with fresh share and link slugs so stats stay separate.
export async function duplicateCampaign({
  automationId,
  workspaceId,
}: {
  automationId: string;
  workspaceId: string;
}) {
  const source = await prisma.automation.findFirst({
    where: { id: automationId, workspaceId },
    include: { trackedLinks: { orderBy: TRACKED_LINK_ORDER } },
  });

  if (!source) return null;

  const { trackedLinks, ...settings } = source;

  return prisma.automation.create({
    data: {
      ...settings,
      // `undefined` leaves the field out of the insert, so the column default
      // (new id, timestamps of now) applies.
      id: undefined,
      createdAt: undefined,
      updatedAt: undefined,
      name: buildDuplicateName(settings.name),
      isActive: false,
      reportShareSlug: generateReportShareSlug(),
      trackedLinks: {
        // Renumbered from the read order, closing gaps or ties in the original.
        create: trackedLinks.map((link, position) => ({
          workspaceId: source.workspaceId,
          slug: generateTrackedLinkSlug(),
          label: link.label,
          destinationUrl: link.destinationUrl,
          position,
        })),
      },
    },
    include: { trackedLinks: true },
  });
}
