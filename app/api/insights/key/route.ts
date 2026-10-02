import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { InsightError, verifyOpenRouterKey } from "@/lib/insights";
import { encryptToken } from "@/lib/meta/oauth";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

const bodySchema = z.object({ apiKey: z.string().trim().min(10).max(512) });
const fail = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });

async function authorize(request: Request) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return { response: fail("Unauthorized", 401) };
  if (!canManageWorkspace(context.role)) return { response: fail("Only workspace owners and admins can manage the OpenRouter key.", 403) };
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return { response: fail("Invalid request origin.", 403) };
  return { context };
}

export async function PUT(request: Request) {
  const { context, response } = await authorize(request);
  if (!context) return response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Paste a valid OpenRouter API key.", 400);
  try {
    await verifyOpenRouterKey(parsed.data.apiKey);
  } catch (error) {
    return fail(error instanceof InsightError ? error.message : "Could not reach OpenRouter. Please retry.", 400);
  }
  await prisma.workspace.update({
    where: { id: context.workspaceId },
    data: { openrouterApiKey: encryptToken(parsed.data.apiKey) },
  });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const { context, response } = await authorize(request);
  if (!context) return response;
  await prisma.workspace.update({ where: { id: context.workspaceId }, data: { openrouterApiKey: null } });
  return NextResponse.json({ success: true });
}
