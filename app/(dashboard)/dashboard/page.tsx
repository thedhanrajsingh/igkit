"use client";

/**
 * Dashboard Home Page
 *
 * Performance panel (month total, four tiles, the 7-day hero chart), the
 * keyword strip, then delivery mix, delivery rate and recent activity.
 */

import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "@phosphor-icons/react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import StatusBadge from "@/components/status-badge";

interface DashboardStats {
  userName: string | null;
  contactsCount: number;
  totalAutomations: number;
  activeAutomations: number;
  dmsSentToday: number;
  dmsSentWeek: number;
  dmsSentPrevWeek: number;
  dmsSentMonth: number;
  dmsSkippedMonth: number;
  dmsFailedMonth: number;
  totalDMs: number;
  clicksThisMonth: number;
  totalClicks: number;
  ctrThisMonth: number;
  instagramAccounts: AccountOption[];
  selectedInstagramAccountId: string | null;
  topKeywords: { keyword: string; count: number }[];
  dailyDMs: { date: string; count: number }[];
  recentLogs: Array<{
    id: string;
    commenterName: string | null;
    commentText: string;
    status: string;
    createdAt: string;
    automation: { name: string };
    instagramAccount?: { username: string };
  }>;
}

const roundLink =
  "grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border text-foreground transition-colors hover:border-border-hover hover:bg-surface";

/** Week-over-week change in percent, or null when there is nothing to compare. */
function weekChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function DeltaPill({ change, onHero = false }: { change: number | null; onHero?: boolean }) {
  const { t } = useI18n();
  if (change === null) return null;
  const up = change >= 0;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  const tone = onHero
    ? "bg-white text-zinc-900"
    : up
      ? "bg-success/15 text-success"
      : "bg-error/15 text-error";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium tabular ${tone}`}
      title={t("vs. the 7 days before")}
    >
      <Arrow size={12} weight="bold" aria-hidden />
      {Math.abs(change)}%
      <span className="sr-only">{up ? t("up") : t("down")} {t("vs. the 7 days before")}</span>
    </span>
  );
}

function HeroTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { date: string; count: number } }>;
}) {
  const { t, label } = useI18n();
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-2xl bg-zinc-950 px-4 py-3 text-xs text-white shadow-[0_12px_32px_rgba(0,0,0,0.35)]">
      <p className="text-white/70">{label(point.date)}</p>
      <p className="mt-1 text-sm font-semibold tabular">
        {t(point.count === 1 ? "{count} DM sent" : "{count} DMs sent", { count: point.count })}
      </p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="panel h-[420px] animate-pulse" />
      <div className="panel h-24 animate-pulse" />
      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr_1fr]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="panel h-72 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { t, label, locale } = useI18n();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedAccountId, setSelectedAccountId] = useState("all");

  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedAccountId !== "all") {
      params.set("instagramAccountId", selectedAccountId);
    }

    fetch(`/api/dashboard/stats${params.size ? `?${params}` : ""}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setStats(data.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedAccountId]);

  function handleAccountChange(accountId: string) {
    setLoading(true);
    setSelectedAccountId(accountId);
  }

  if (loading || !stats) return <DashboardSkeleton />;

  const fmt = (n: number) => n.toLocaleString(locale);
  const connectedCount = stats.instagramAccounts.length;
  const change = weekChange(stats.dmsSentWeek, stats.dmsSentPrevWeek);

  const handled = stats.dmsSentMonth + stats.dmsSkippedMonth + stats.dmsFailedMonth;
  const share = (n: number) => (handled ? Math.round((n / handled) * 100) : 0);
  const delivery = [
    { key: "sent", label: t("Sent"), value: stats.dmsSentMonth, fill: "bg-accent", ink: "text-white" },
    { key: "skipped", label: t("Skipped"), value: stats.dmsSkippedMonth, fill: "bg-warning", ink: "text-zinc-900" },
    { key: "failed", label: t("Failed"), value: stats.dmsFailedMonth, fill: "bg-foreground", ink: "text-zinc-900" },
  ];

  const attempted = stats.dmsSentMonth + stats.dmsFailedMonth;
  const deliveryRate = attempted ? Math.round((stats.dmsSentMonth / attempted) * 100) : null;

  const keywordTotal = stats.topKeywords.reduce((sum, k) => sum + k.count, 0);
  const tiles = [
    { label: t("Sent today"), value: fmt(stats.dmsSentToday) },
    { label: t("Active Campaigns"), value: fmt(stats.activeAutomations) },
    { label: t("Clicks"), value: fmt(stats.clicksThisMonth) },
    { label: t("CTR"), value: `${stats.ctrThisMonth}%` },
  ];

  return (
    <div className="rise space-y-4">
      {/* Performance */}
      <section className="panel p-4 sm:p-6" style={{ "--i": 0 } as React.CSSProperties}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto min-w-0">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {t("Hello, {name}!", { name: stats.userName ?? t("there") })}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {t(connectedCount === 1 ? "{count} connected account" : "{count} connected accounts", { count: connectedCount })}
              {" · "}
              {t(stats.contactsCount === 1 ? "{count} contact" : "{count} contacts", { count: stats.contactsCount })}
            </p>
          </div>
          {connectedCount > 1 && (
            <AccountSelect
              accounts={stats.instagramAccounts}
              value={selectedAccountId}
              onChange={handleAccountChange}
            />
          )}
          <Link
            href="/campaigns/new"
            className="flex h-10 items-center rounded-full bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            {t("New Campaign")}
          </Link>
          <Link href="/logs" className={roundLink} aria-label={t("See activity")}>
            <ArrowUpRight size={18} aria-hidden />
          </Link>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
          <div className="flex flex-col">
            <p className="text-sm text-muted">{t("DMs sent this month")}</p>
            <p className="mt-2 text-5xl font-semibold tracking-tight tabular">{fmt(stats.dmsSentMonth)}</p>
            <div className="mt-6 grid flex-1 grid-cols-2 gap-3">
              {tiles.map((tile) => (
                <div key={tile.label} className="flex flex-col justify-between rounded-2xl bg-surface p-4">
                  <p className="text-sm text-muted">{tile.label}</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight tabular">{tile.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-3xl bg-hero p-5 text-white">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm text-white/85">{t("DMs sent, last 7 days")}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <p className="text-4xl font-semibold tracking-tight tabular sm:text-5xl">{fmt(stats.dmsSentWeek)}</p>
                  <DeltaPill change={change} onHero />
                </div>
              </div>
            </div>
            <div
              className="mt-4 h-52 sm:h-60"
              role="img"
              aria-label={stats.dailyDMs.map((d) => `${label(d.date)} ${d.count}`).join(", ")}
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.dailyDMs} margin={{ top: 8, right: 4, bottom: 0, left: -24 }}>
                  <defs>
                    <pattern id="hero-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <rect width="7" height="7" fill="rgba(255,255,255,0.08)" />
                      <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(255,255,255,0.28)" strokeWidth="1.5" />
                    </pattern>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string) => label(value)}
                    tick={{ fill: "rgba(255,255,255,0.85)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    dy={6}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: "rgba(255,255,255,0.7)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <Tooltip content={<HeroTooltip />} cursor={{ stroke: "rgba(255,255,255,0.5)", strokeWidth: 24, strokeOpacity: 0.18 }} />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="#ffffff"
                    strokeWidth={2}
                    fill="url(#hero-hatch)"
                    activeDot={{ r: 5, fill: "#ffffff", stroke: "#d9370f", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {stats.dmsSentWeek === 0 && (
              <p className="absolute inset-x-5 bottom-16 text-center text-sm text-white/85">
                {t("No DMs sent in the last 7 days")}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Top keywords strip */}
      <section
        className="panel flex flex-wrap items-center gap-x-6 gap-y-4 p-4 sm:px-6"
        style={{ "--i": 1 } as React.CSSProperties}
      >
        <h2 className="text-sm text-muted">{t("Top Keywords")}</h2>
        {stats.topKeywords.length === 0 ? (
          <p className="text-sm text-muted">{t("No keyword matches yet")}</p>
        ) : (
          <ul className="flex min-w-0 flex-1 flex-wrap gap-x-8 gap-y-3">
            {stats.topKeywords.slice(0, 4).map((keyword) => (
              <li key={keyword.keyword} className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-foreground text-sm font-semibold text-background">
                  {keyword.keyword.charAt(0).toUpperCase()}
                </span>
                <span>
                  <span className="block text-sm font-medium uppercase">{keyword.keyword}</span>
                  <span className="text-sm tabular">
                    {fmt(keyword.count)}{" "}
                    <span className="text-muted">· {Math.round((keyword.count / keywordTotal) * 100)}%</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/campaigns" className={roundLink} aria-label={t("Campaigns")}>
          <ArrowUpRight size={18} aria-hidden />
        </Link>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr_1fr]">
        {/* Delivery mix */}
        <section className="panel flex flex-col p-4 sm:p-6" style={{ "--i": 2 } as React.CSSProperties}>
          <h2 className="text-sm text-muted">{t("Delivery this month")}</h2>
          <div className="mt-5 grid flex-1 grid-cols-3 gap-3">
            {delivery.map((bar) => (
              <div key={bar.key} className="flex flex-col gap-2">
                <div className="hatch relative flex min-h-44 flex-1 flex-col justify-end overflow-hidden rounded-2xl bg-surface">
                  <div
                    className={`${bar.fill} ${bar.ink} rounded-2xl p-3 text-sm font-semibold tabular`}
                    style={{ height: `${Math.max(share(bar.value), 18)}%` }}
                  >
                    {share(bar.value)}%
                  </div>
                </div>
                <p className="text-center text-sm text-muted">
                  {bar.label} <span className="text-foreground tabular">{fmt(bar.value)}</span>
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Delivery rate */}
        <section className="panel flex flex-col p-4 sm:p-6" style={{ "--i": 3 } as React.CSSProperties}>
          <h2 className="text-sm text-muted">{t("Delivery rate")}</h2>
          <p className="mt-3 text-5xl font-semibold tracking-tight tabular">
            {deliveryRate ?? 0}
            <span className="ml-1 text-2xl font-normal text-muted">/100</span>
          </p>
          <svg viewBox="0 0 200 110" className="mt-auto w-full" aria-hidden>
            <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="var(--tile-2)" strokeWidth="18" strokeLinecap="round" />
            {deliveryRate !== null && deliveryRate > 0 && (
              <path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none"
                stroke="var(--ok)"
                strokeWidth="18"
                strokeLinecap="round"
                pathLength={100}
                strokeDasharray={`${deliveryRate} 100`}
              />
            )}
          </svg>
          <p className="mt-2 text-center text-sm text-muted">
            {deliveryRate === null
              ? t("No DMs sent this month yet")
              : t("{count} failed this month", { count: fmt(stats.dmsFailedMonth) })}
          </p>
        </section>

        {/* Recent activity */}
        <section
          className="panel flex flex-col p-4 sm:p-6"
          // A lighter panel, like the reference's insight card.
          style={{ "--i": 4, background: "var(--tile)" } as React.CSSProperties}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm text-muted">{t("Recent Activity")}</h2>
            <Link href="/logs" className={roundLink} aria-label={t("See activity")}>
              <ArrowUpRight size={18} aria-hidden />
            </Link>
          </div>
          {stats.recentLogs.length === 0 ? (
            <p className="my-auto py-8 text-center text-sm text-muted">{t("No activity yet")}</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {stats.recentLogs.slice(0, 4).map((log) => (
                <li key={log.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">@{log.commenterName ?? "unknown"}</p>
                    <p className="truncate text-xs text-muted">{log.commentText}</p>
                  </div>
                  <StatusBadge status={log.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
