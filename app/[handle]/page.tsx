import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/db/client";
import { BIO_THEMES, type BioTheme } from "@/lib/bio";

type Props = { params: Promise<{ handle: string }> };

const getPage = cache((handle: string) =>
  prisma.bioPage.findFirst({
    where: { handle: handle.toLowerCase(), isPublished: true },
    include: {
      links: {
        where: { isActive: true },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { id: true, title: true },
      },
    },
  })
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await getPage((await params).handle);
  if (!page) return {};
  const description = page.bio ?? `${page.title} (@${page.handle}): links`;
  return {
    title: { absolute: `${page.title} (@${page.handle})` },
    description,
    alternates: { canonical: `/${page.handle}` },
    openGraph: {
      type: "profile",
      title: page.title,
      description,
      url: `/${page.handle}`,
      images: page.avatarUrl ? [page.avatarUrl] : undefined,
    },
  };
}

export default async function BioPage({ params }: Props) {
  const page = await getPage((await params).handle);
  if (!page) notFound();

  const theme = BIO_THEMES[page.theme as BioTheme] ?? BIO_THEMES.light;

  return (
    <main
      className="min-h-dvh px-4 py-12"
      style={{ background: theme.page, color: theme.text }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "ProfilePage",
            mainEntity: {
              "@type": "Person",
              name: page.title,
              alternateName: `@${page.handle}`,
              description: page.bio ?? undefined,
              image: page.avatarUrl ?? undefined,
            },
          }).replace(/</g, "\\u003c"),
        }}
      />
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        {page.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary creator-supplied host
          <img
            src={page.avatarUrl}
            alt=""
            className="h-24 w-24 rounded-full object-cover"
            style={{ border: `2px solid ${theme.border}` }}
          />
        ) : (
          <div
            className="flex h-24 w-24 items-center justify-center rounded-full text-3xl font-semibold"
            style={{ background: theme.button, color: theme.buttonText }}
          >
            {page.title.charAt(0).toUpperCase()}
          </div>
        )}
        <h1 className="mt-4 text-xl font-semibold">{page.title}</h1>
        <p className="mt-1 text-sm" style={{ color: theme.muted }}>@{page.handle}</p>
        {page.bio ? (
          <p className="mt-3 whitespace-pre-line text-sm" style={{ color: theme.muted }}>
            {page.bio}
          </p>
        ) : null}

        <nav className="mt-8 flex w-full flex-col gap-3">
          {page.links.map((link) => (
            <a
              key={link.id}
              href={`/go/${link.id}`}
              rel="noopener"
              className="block w-full rounded-xl px-5 py-4 text-sm font-medium transition-transform hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{
                background: theme.button,
                color: theme.buttonText,
                border: `1px solid ${theme.border}`,
              }}
            >
              {link.title}
            </a>
          ))}
        </nav>

        <Link href="/" className="mt-12 text-xs opacity-70" style={{ color: theme.muted }}>
          IGKit
        </Link>
      </div>
    </main>
  );
}
