import type { Prisma } from "@/app/generated/prisma/client";

// Button order (first link is primary). createdAt and id break position ties
// from older builds; without them Postgres may return tied rows in any order.
export const TRACKED_LINK_ORDER = [
  { position: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
] satisfies Prisma.TrackedLinkOrderByWithRelationInput[];
