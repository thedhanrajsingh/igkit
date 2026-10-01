import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

type RouteProps = { params: Promise<{ id: string }> };

// Bio page link click: count it, then send the visitor on.
export async function GET(request: NextRequest, { params }: RouteProps) {
  const { id } = await params;
  const link = await prisma.bioLink.findFirst({
    where: { id, isActive: true, bioPage: { isPublished: true } },
    select: { url: true },
  });

  if (!link) {
    return NextResponse.redirect(new URL("/", request.url), { status: 302 });
  }

  await prisma.bioLink.update({ where: { id }, data: { clicks: { increment: 1 } } });
  return NextResponse.redirect(link.url, { status: 302 });
}
