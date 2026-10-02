"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowClockwise, Sparkle } from "@phosphor-icons/react";
import { useI18n } from "@/lib/i18n/provider";

type Suggestion = {
  id: string;
  kind: string;
  value: string;
  reason: string;
  status: string;
  automation: { name: string };
};
type Insight = { id: string; text: string; model: string; toolsUsed: string[]; createdAt: string; suggestions: Suggestion[] };

const roundButton =
  "grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border text-foreground transition-colors hover:border-border-hover hover:bg-surface disabled:opacity-50";

function SuggestionItem({ suggestion, canManage, onDone }: { suggestion: Suggestion; canManage: boolean; onDone: (status: string) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = suggestion.automation.name;

  async function act(action: "apply" | "dismiss") {
    setBusy(true);
    setError("");
    try {
      const result = await fetch(`/api/insights/suggestions/${suggestion.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }).then((r) => r.json());
      if (!result.success) throw new Error(result.error);
      onDone(action === "apply" ? "APPLIED" : "DISMISSED");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not update the campaign."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-2xl bg-surface p-3 text-sm">
      <p className="font-medium">
        {suggestion.kind === "dm_message"
          ? t("New DM text for {name}", { name })
          : suggestion.kind === "add_keywords"
            ? t("Add keywords to {name}", { name })
            : t("Pause {name}", { name })}
      </p>
      {suggestion.kind === "dm_message" && (
        <p className="mt-2 line-clamp-4 whitespace-pre-line border-l-2 border-border pl-3 text-muted">{suggestion.value}</p>
      )}
      {suggestion.kind === "add_keywords" && (
        <p className="mt-2 flex flex-wrap gap-1.5">
          {(JSON.parse(suggestion.value) as string[]).map((k) => (
            <span key={k} className="rounded-full bg-foreground px-2.5 py-0.5 text-xs font-medium uppercase text-background">{k}</span>
          ))}
        </p>
      )}
      <p className="mt-2 text-xs text-muted">{suggestion.reason}</p>
      {suggestion.status !== "PENDING" ? (
        <p className="mt-2 text-xs font-medium">{suggestion.status === "APPLIED" ? t("Applied") : t("Dismissed")}</p>
      ) : canManage ? (
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={busy} onClick={() => act("apply")} className="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50">
            {t("Apply")}
          </button>
          <button type="button" disabled={busy} onClick={() => act("dismiss")} className="rounded-full border border-border px-3 py-1.5 text-xs disabled:opacity-50">
            {t("Dismiss")}
          </button>
        </div>
      ) : null}
      {error && <p role="alert" className="mt-2 text-xs text-error">{error}</p>}
    </li>
  );
}

export default function InsightsCard({ style }: { style?: React.CSSProperties }) {
  const { t, locale } = useI18n();
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [configured, setConfigured] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/insights", { cache: "no-store" })
      .then((r) => r.json())
      .then((result) => {
        if (!result.success) throw new Error(result.error);
        setConfigured(result.data.configured);
        setCanManage(result.data.canManage);
        setInsights(result.data.insights);
      })
      .catch(() => setInsights([]));
  }, []);

  // Runs only on click: every run spends OpenRouter credits.
  async function generate() {
    setBusy(true);
    setError("");
    try {
      const result = await fetch("/api/insights", { method: "POST" }).then((r) => r.json());
      if (!result.success) throw new Error(result.error);
      setInsights((prev) => [result.data, ...(prev ?? [])]);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not generate an insight."));
    } finally {
      setBusy(false);
    }
  }

  function markSuggestion(id: string, status: string) {
    setInsights((prev) =>
      prev?.map((i) => ({ ...i, suggestions: i.suggestions.map((s) => (s.id === id ? { ...s, status } : s)) })) ?? null,
    );
  }

  const [latest, ...past] = insights ?? [];
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const suggestionList = (insight: Insight) =>
    insight.suggestions.length > 0 && (
      <ul className="mt-3 space-y-2">
        {insight.suggestions.map((s) => (
          <SuggestionItem key={s.id} suggestion={s} canManage={canManage} onDone={(status) => markSuggestion(s.id, status)} />
        ))}
      </ul>
    );
  const toolLabels: Record<string, string> = { list_campaigns: t("campaigns"), get_campaign_activity: t("comment activity") };
  const checked = latest?.toolsUsed.map((name) => toolLabels[name]).filter(Boolean) ?? [];

  return (
    <section className="panel flex flex-col p-4 sm:p-6" style={{ ...style, background: "var(--tile)" }} aria-busy={busy}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm text-muted">
          <Sparkle size={16} weight="fill" className="text-foreground" aria-hidden />
          {t("AI Insights")}
        </h2>
        {configured && (
          <button type="button" onClick={generate} disabled={busy} className={roundButton} aria-label={t("Generate new insight")}>
            <ArrowClockwise size={18} className={busy ? "animate-spin" : ""} aria-hidden />
          </button>
        )}
      </div>

      {insights === null ? (
        <div className="mt-4 h-20 animate-pulse rounded-2xl bg-surface" />
      ) : !configured && !latest ? (
        <p className="my-auto py-8 text-center text-sm text-muted">
          {t("Add an OpenRouter API key in")}{" "}
          <Link href="/settings" className="text-foreground underline underline-offset-4">{t("Settings")}</Link>{" "}
          {t("to get AI insights on your campaigns.")}
        </p>
      ) : busy && !latest ? (
        <p className="my-auto py-8 text-center text-sm text-muted">{t("The agent is reviewing your campaigns…")}</p>
      ) : !latest ? (
        <p className="my-auto py-8 text-center text-sm text-muted">{t("Press refresh to get your first insight.")}</p>
      ) : (
        <>
          {busy && <p className="mt-4 text-xs text-muted">{t("The agent is reviewing your campaigns…")}</p>}
          <p className="mt-4 text-sm leading-6" aria-live="polite">{latest.text}</p>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="rounded-full bg-surface px-2.5 py-1 font-medium text-foreground">{latest.model}</span>
            {when(latest.createdAt)}
          </p>
          {checked.length > 0 && <p className="mt-2 text-xs text-muted">{t("Checked: {list}", { list: checked.join(", ") })}</p>}
          {suggestionList(latest)}
          {past.length > 0 && (
            <details className="mt-auto pt-4 text-sm">
              <summary className="cursor-pointer text-muted">{t("Past insights ({count})", { count: past.length })}</summary>
              <ul className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-1">
                {past.map((insight) => (
                  <li key={insight.id} className="rounded-2xl border border-border p-3">
                    <p className="leading-6">{insight.text}</p>
                    <p className="mt-1 text-xs text-muted">{insight.model} · {when(insight.createdAt)}</p>
                    {suggestionList(insight)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {error && <p role="alert" className="mt-3 text-xs text-error">{error}</p>}
    </section>
  );
}
