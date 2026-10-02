import { NextRequest, NextResponse } from "next/server";
import { GET as getDashboardStats } from "@/app/api/dashboard/stats/route";
import { prisma } from "@/lib/db/client";
import { InsightError, runInsightAgent, workspaceTools } from "@/lib/insights";
import { decryptToken } from "@/lib/meta/oauth";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

// The agent makes up to 6 model calls.
export const maxDuration = 120;

const unauthorized = () => NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
const insightSelect = {
  id: true,
  text: true,
  model: true,
  toolsUsed: true,
  createdAt: true,
  suggestions: {
    orderBy: { createdAt: "asc" as const },
    select: { id: true, kind: true, value: true, reason: true, status: true, automation: { select: { name: true } } },
  },
};

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return unauthorized();
  const insights = await prisma.aiInsight.findMany({
    where: { workspaceId: context.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: insightSelect,
  });
  return NextResponse.json({
    success: true,
    data: {
      configured: Boolean(context.workspace.openrouterApiKey),
      canManage: canManageWorkspace(context.role),
      insights,
    },
  });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return unauthorized();
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ success: false, error: "Invalid request origin." }, { status: 403 });
  }
  if (!context.workspace.openrouterApiKey) {
    return NextResponse.json({ success: false, error: "Add an OpenRouter API key in Settings first." }, { status: 400 });
  }

  // Overview goes in the first message so the agent only spends calls on drill-downs.
  const statsRes = await getDashboardStats(new NextRequest(new URL("/api/dashboard/stats", request.url)));
  const { data } = await statsRes.json();
  if (!data) return NextResponse.json({ success: false, error: "Could not load your stats." }, { status: 500 });
  const overview = {
    dmsSentToday: data.dmsSentToday,
    dmsSentWeek: data.dmsSentWeek,
    dmsSentPrevWeek: data.dmsSentPrevWeek,
    dmsSentMonth: data.dmsSentMonth,
    dmsSkippedMonth: data.dmsSkippedMonth,
    dmsFailedMonth: data.dmsFailedMonth,
    clicksThisMonth: data.clicksThisMonth,
    ctrThisMonth: data.ctrThisMonth,
    activeAutomations: data.activeAutomations,
    contactsCount: data.contactsCount,
    topKeywords: data.topKeywords.slice(0, 5),
    dailyDMs: data.dailyDMs,
  };
  const previous = await prisma.aiInsight.findMany({
    where: { workspaceId: context.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { text: true },
  });
  const prompt =
    `Workspace overview (JSON): ${JSON.stringify(overview)}` +
    (previous.length ? `\nDo not repeat these recent insights:\n- ${previous.map((p) => p.text).join("\n- ")}` : "");

  const tools = workspaceTools(context.workspaceId);
  try {
    const result = await runInsightAgent(decryptToken(context.workspace.openrouterApiKey), prompt, tools.run);
    const insight = await prisma.aiInsight.create({
      data: { workspaceId: context.workspaceId, ...result, suggestions: { create: tools.proposals } },
      select: insightSelect,
    });
    return NextResponse.json({ success: true, data: insight });
  } catch (error) {
    const message = error instanceof InsightError ? error.message : "Could not reach OpenRouter. Please retry.";
    const status = error instanceof InsightError ? error.status : 502;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
