import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { bioPageSchema } from "@/lib/bio";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

function loadPage(workspaceId: string) {
  return prisma.bioPage.findUnique({
    where: { workspaceId },
    include: { links: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
  });
}

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const [page, account] = await Promise.all([
    loadPage(context.workspaceId),
    prisma.instagramAccount.findFirst({
      where: { workspaceId: context.workspaceId },
      orderBy: { connectedAt: "desc" },
      select: { username: true, name: true },
    }),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      page,
      canEdit: canManageWorkspace(context.role),
      suggestedHandle: account?.username.toLowerCase().replace(/[^a-z0-9_]/g, "_") ?? "",
      suggestedTitle: account?.name ?? account?.username ?? context.workspace.name,
    },
  });
}

export async function PUT(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can edit the bio page" },
      { status: 403 }
    );
  }

  const parsed = bioPageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Invalid bio page" },
      { status: 400 }
    );
  }

  const { links, ...fields } = parsed.data;
  const data = { ...fields, bio: fields.bio || null, avatarUrl: fields.avatarUrl || null };

  try {
    await prisma.$transaction(async (tx) => {
      const page = await tx.bioPage.upsert({
        where: { workspaceId: context.workspaceId },
        create: { ...data, workspaceId: context.workspaceId },
        update: data,
      });

      // Keep ids for edited links so their click counts survive a save.
      const keptIds = links.flatMap((link) => (link.id ? [link.id] : []));
      await tx.bioLink.deleteMany({ where: { bioPageId: page.id, id: { notIn: keptIds } } });

      for (const [position, { id, ...link }] of links.entries()) {
        const updated = id
          ? await tx.bioLink.updateMany({ where: { id, bioPageId: page.id }, data: { ...link, position } })
          : { count: 0 };
        if (updated.count === 0) {
          await tx.bioLink.create({ data: { ...link, position, bioPageId: page.id } });
        }
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ success: false, error: "That handle is taken" }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({ success: true, data: { page: await loadPage(context.workspaceId) } });
}
