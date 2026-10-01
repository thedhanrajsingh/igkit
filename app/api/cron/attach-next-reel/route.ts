import { NextRequest, NextResponse } from "next/server";
import { attachPendingNextReels } from "@/lib/automation/attach-next-reel";

// Instagram sends no webhook for new media, so "next reel" campaigns are bound by
// polling: each attaches to the earliest reel posted after it was created.

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const result = await attachPendingNextReels();

  return NextResponse.json({
    success: true,
    data: result,
  });
}
