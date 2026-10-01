"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import LanguageSwitcher from "@/components/language-switcher";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/top-bar";
import type { StaticMessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/provider";
import { zernioLink } from "@/lib/zernio-links";

// Only pages without their own <h1> get a heading from the shell.
const pageTitles: Record<string, StaticMessageKey> = {
  "/campaigns": "Campaigns",
  "/campaigns/new": "New Campaign",
  "/automations": "Campaigns",
  "/automations/new": "New Campaign",
  "/logs": "DM Logs",
  "/settings": "Settings",
};

interface DashboardShellProps {
  children: React.ReactNode;
  workspaceName: string;
  instagramUsername: string | null;
  instagramAccountCount: number;
}

export default function DashboardShell({
  children,
  workspaceName,
  instagramUsername,
  instagramAccountCount,
}: DashboardShellProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const title: StaticMessageKey | null =
    pageTitles[pathname] ?? (pathname.endsWith("/edit") ? "Edit campaign" : null);

  return (
    <div className="app-shell min-h-dvh">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        workspaceName={workspaceName}
      />

      {/* overflow-x-clip: a wide child must not drag the page sideways on a phone. */}
      <div className="mx-auto flex min-h-dvh max-w-[1400px] flex-col gap-6 overflow-x-clip px-3 py-3 sm:px-6 sm:py-5">
        <TopBar
          onMenuClick={() => setSidebarOpen(true)}
          instagramUsername={instagramUsername}
          instagramAccountCount={instagramAccountCount}
          workspaceName={workspaceName}
        />

        <main className="flex-1">
          {title ? (
            <h1 className="mb-6 text-2xl font-semibold tracking-tight sm:text-3xl">{t(title)}</h1>
          ) : null}
          {children}
        </main>

        <footer className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border pt-5 text-xs text-muted">
          <span>
            <span className="text-foreground">{workspaceName}</span> · {t("Self-hosted")}
          </span>
          <LanguageSwitcher />
          <a
            href={zernioLink({ placement: "sidebar" })}
            target="_blank"
            rel="sponsored noopener noreferrer"
            className="ml-auto flex items-center gap-2 hover:text-foreground"
          >
            <span>{t("Supported by")}</span>
            <Image src="/brand/zernio-primary.svg" alt="Zernio" width={64} height={20} />
          </a>
        </footer>
      </div>
    </div>
  );
}
