import { NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";

// One indexed query for account selectors, so pages like the inbox aren't gated on
// the heavy /api/dashboard/stats aggregation.
export async function GET() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const instagramAccounts = await prisma.instagramAccount.findMany({
    where: { workspaceId },
    orderBy: { connectedAt: "desc" },
    select: { id: true, username: true, instagramId: true, name: true },
  });

  return NextResponse.json({
    success: true,
    data: {
      instagramAccounts,
      selectedInstagramAccountId: instagramAccounts[0]?.id ?? null,
    },
  });
}
