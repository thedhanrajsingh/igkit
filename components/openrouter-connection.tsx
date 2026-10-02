"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";

export function OpenRouterConnection() {
  const { t } = useI18n();
  const [status, setStatus] = useState<{ configured: boolean; canManage: boolean } | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = () =>
    fetch("/api/insights", { cache: "no-store" })
      .then((r) => r.json())
      .then((result) => { if (result.success) setStatus(result.data); });
  useEffect(() => {
    fetch("/api/insights", { cache: "no-store" })
      .then((r) => r.json())
      .then((result) => { if (result.success) setStatus(result.data); })
      .catch(() => {});
  }, []);

  async function act(method: "PUT" | "DELETE") {
    setBusy(true);
    setError("");
    try {
      const result = await fetch("/api/insights/key", {
        method,
        headers: { "Content-Type": "application/json" },
        ...(method === "PUT" ? { body: JSON.stringify({ apiKey }) } : {}),
      }).then((r) => r.json());
      if (!result.success) throw new Error(result.error);
      setApiKey("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not update the OpenRouter key."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel rounded p-4 sm:p-6 space-y-3" aria-labelledby="openrouter-heading">
      <h2 id="openrouter-heading" className="text-base font-semibold">{t("AI Insights")}</h2>
      <p className="text-sm text-muted">
        {t("Uses your OpenRouter key with Jev Router, which picks the best model (OpenAI, Gemini and more) for each insight. Usage is billed to your OpenRouter account.")}
      </p>
      {!status ? null : !status.canManage ? (
        <p className="text-sm">{status.configured ? t("OpenRouter key saved securely.") : t("Ask your workspace owner or admin to add an OpenRouter key.")}</p>
      ) : status.configured ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">{t("OpenRouter key saved securely.")}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => { if (confirm(t("Remove the OpenRouter key? Past insights stay saved."))) void act("DELETE"); }}
            className="text-xs underline underline-offset-4 disabled:opacity-50"
          >
            {t("Remove key")}
          </button>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void act("PUT"); }}>
          <label className="block text-sm font-medium" htmlFor="openrouter-api-key">{t("OpenRouter API key")}</label>
          <input
            id="openrouter-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            required
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted">
            <a className="underline underline-offset-4" href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer">{t("Get an OpenRouter key")}</a>
            {" · "}
            {t("The key is encrypted and never shown again.")}
          </p>
          <button disabled={busy || !apiKey} className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50">
            {busy ? t("Checking key…") : t("Save API key")}
          </button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
    </section>
  );
}
