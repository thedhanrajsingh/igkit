"use client";

import { navItems } from "@/components/sidebar";
import { useI18n } from "@/lib/i18n/provider";
import { ChatsCircle, InstagramLogo, List } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface TopBarProps {
  onMenuClick: () => void;
  instagramUsername: string | null;
  instagramAccountCount: number;
  workspaceName: string;
}

const roundButton =
  "grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-panel text-foreground transition-colors hover:border-border-hover hover:bg-surface";

export default function TopBar({
  onMenuClick,
  instagramUsername,
  instagramAccountCount,
  workspaceName,
}: TopBarProps) {
  const { t } = useI18n();
  const pathname = usePathname();

  return (
    <header
      className="flex items-center gap-3"
      // Installed to the home screen the app starts at the very top of the
      // display; the inset is 0 in a browser tab and on desktop.
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <button
        type="button"
        onClick={onMenuClick}
        className={`${roundButton} xl:hidden`}
        aria-label={t("Toggle sidebar")}
      >
        <List size={20} aria-hidden />
      </button>

      <Link
        href="/dashboard"
        className="flex h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-panel px-4 text-[15px] font-semibold tracking-tight"
      >
        <ChatsCircle size={22} weight="fill" className="text-accent" aria-hidden />
        IGKit
      </Link>

      <nav
        aria-label={t("Menu")}
        className="hidden min-w-0 items-center gap-1 rounded-full border border-border bg-panel p-1 xl:flex"
      >
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-foreground font-medium text-background"
                  : "text-muted hover:bg-surface hover:text-foreground"
              }`}
            >
              {t(item.label)}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex min-w-0 items-center gap-2">
        {instagramAccountCount > 0 ? (
          <span className="flex h-11 min-w-0 items-center gap-2 rounded-full border border-border bg-panel px-4 text-sm text-muted">
            <InstagramLogo size={18} className="shrink-0 text-foreground" aria-hidden />
            <span className="truncate">
              {instagramAccountCount > 1
                ? t("{count} accounts", { count: instagramAccountCount })
                : `@${instagramUsername}`}
            </span>
          </span>
        ) : (
          <a
            href="/api/instagram/connect"
            className="flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            <InstagramLogo size={18} aria-hidden />
            {/* Full label needs more room than a 360px header has to spare. */}
            <span className="sm:hidden">{t("Connect")}</span>
            <span className="hidden sm:inline">{t("Connect Instagram")}</span>
          </a>
        )}
        <Link
          href="/settings"
          className={`${roundButton} hidden text-sm font-semibold sm:grid`}
          aria-label={t("Settings")}
          title={workspaceName}
        >
          {workspaceName.charAt(0).toUpperCase()}
        </Link>
      </div>
    </header>
  );
}
