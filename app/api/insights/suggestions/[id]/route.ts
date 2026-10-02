import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PATCH as patchCampaign } from "@/app/api/automations/route";
import { prisma } from "@/lib/db/client";
import { suggestionPatch } from "@/lib/insights";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

type RouteProps = { params: Promise<{ id: string }> };
const bodySchema = z.object({ action: z.enum(["apply", "dismiss"]) });
const fail = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });

export async function POST(request: NextRequest, { params }: RouteProps) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return fail("Unauthorized", 401);
  if (!canManageWorkspace(context.role)) return fail("Only owners and admins can change campaigns.", 403);
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return fail("Invalid request origin.", 403);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Choose apply or dismiss.", 400);

  const { id } = await params;
  const suggestion = await prisma.aiSuggestion.findFirst({
    where: { id, status: "PENDING", insight: { workspaceId: context.workspaceId } },
    include: { automation: { select: { keywords: true } } },
  });
  if (!suggestion) return fail("This suggestion was already handled.", 404);

  if (parsed.data.action === "apply") {
    // Same validation, permissions and link handling as a manual campaign edit.
    const res = await patchCampaign(
      new NextRequest(new URL(`/api/automations?id=${suggestion.automationId}`, request.url), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(suggestionPatch(suggestion.kind, suggestion.value, suggestion.automation.keywords)),
      }),
    );
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: null }));
      return fail(error ?? "Could not update the campaign.", res.status);
    }
  }

  await prisma.aiSuggestion.update({
    where: { id },
    data: { status: parsed.data.action === "apply" ? "APPLIED" : "DISMISSED" },
  });
  return NextResponse.json({ success: true });
}
