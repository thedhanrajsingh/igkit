import { prisma } from "@/lib/db/client";
import {
  createInstagramContext,
  hasInstagramCredentials,
  getUserMedia,
  type InstagramMedia,
} from "@/lib/instagram/provider";

export type AttachNextReelResult = {
  checked: number;
  bound: number;
  failedAccounts: number;
};

// Binds each pending "next reel" campaign to the earliest reel published after it was created.
export async function attachPendingNextReels(): Promise<AttachNextReelResult> {
  const pending = await prisma.automation.findMany({
    where: { pendingNextReel: true },
    include: { instagramAccount: true },
  });

  const byAccount = new Map<
    string,
    {
      account: (typeof pending)[number]["instagramAccount"];
      automations: typeof pending;
    }
  >();
  for (const automation of pending) {
    const key = automation.instagramAccountId;
    const entry = byAccount.get(key);
    if (entry) entry.automations.push(automation);
    else
      byAccount.set(key, {
        account: automation.instagramAccount,
        automations: [automation],
      });
  }

  let checked = 0;
  let bound = 0;
  let failedAccounts = 0;

  for (const { account, automations } of byAccount.values()) {
    checked += automations.length;
    if (!account || !hasInstagramCredentials(account)) continue;

    let reels: InstagramMedia[];
    try {
      const context = await createInstagramContext(account);
      const media = await getUserMedia({ context, limit: 25 });
      reels = media
        .filter((m) => m.media_product_type === "REELS")
        .sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
    } catch (error) {
      failedAccounts += 1;
      console.error("[attach-next-reel] media fetch failed", account.id, error);
      continue;
    }

    for (const automation of automations) {
      const nextReel = reels.find(
        (reel) => new Date(reel.timestamp) > automation.createdAt
      );
      if (!nextReel) continue;

      await prisma.automation.update({
        where: { id: automation.id },
        data: {
          postId: nextReel.id,
          postUrl: nextReel.permalink ?? null,
          pendingNextReel: false,
        },
      });
      bound += 1;
    }
  }

  return { checked, bound, failedAccounts };
}
