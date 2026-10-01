"use client";

import { useI18n } from "@/lib/i18n/provider";
import { BIO_THEMES, type BioTheme } from "@/lib/bio";
import { useEffect, useState } from "react";

type LinkDraft = { id?: string; title: string; url: string; isActive: boolean; clicks?: number };

type Draft = {
  handle: string;
  title: string;
  bio: string;
  avatarUrl: string;
  theme: BioTheme;
  isPublished: boolean;
  links: LinkDraft[];
};

type ServerPage = Omit<Draft, "bio" | "avatarUrl" | "theme"> & {
  bio: string | null;
  avatarUrl: string | null;
  theme: string;
};

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none";
const smallButton =
  "rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground disabled:opacity-40";

function toDraft(page: ServerPage): Draft {
  return {
    ...page,
    bio: page.bio ?? "",
    avatarUrl: page.avatarUrl ?? "",
    theme: page.theme in BIO_THEMES ? (page.theme as BioTheme) : "light",
  };
}

export default function BioEditorPage() {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [canEdit, setCanEdit] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/bio")
      .then((res) => res.json())
      .then((payload) => {
        if (!payload.success) return;
        const { page, suggestedHandle, suggestedTitle } = payload.data;
        setCanEdit(payload.data.canEdit);
        setDraft(
          page
            ? toDraft(page)
            : {
                handle: suggestedHandle,
                title: suggestedTitle,
                bio: "",
                avatarUrl: "",
                theme: "light",
                isPublished: true,
                links: [{ title: "", url: "", isActive: true }],
              }
        );
      });
  }, []);

  if (!draft) return <div className="panel rounded p-8 h-64" />;

  const update = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const updateLink = (index: number, patch: Partial<LinkDraft>) =>
    update({ links: draft.links.map((link, i) => (i === index ? { ...link, ...patch } : link)) });
  const moveLink = (index: number, by: -1 | 1) => {
    const links = [...draft.links];
    [links[index], links[index + by]] = [links[index + by], links[index]];
    update({ links });
  };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/bio", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...draft,
        links: draft.links.map(({ id, title, url, isActive }) => ({ id, title, url, isActive })),
      }),
    });
    const payload = await res.json();
    if (payload.success) {
      setDraft(toDraft(payload.data.page));
      setMessage({ ok: true, text: t("Saved") });
    } else {
      setMessage({ ok: false, text: payload.error ?? t("Could not save") });
    }
    setSaving(false);
  }

  // Only reached on the client: draft stays null until the fetch resolves.
  const origin = window.location.origin;
  const publicUrl = `${origin}/${draft.handle}`;

  return (
    <form onSubmit={save} className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-semibold">{t("Bio page")}</h1>
        <p className="mt-1 text-sm text-muted">
          {t("A link-in-bio page for your Instagram profile. Share it in your bio or DMs.")}
        </p>
      </div>

      <fieldset disabled={!canEdit} className="space-y-8">
        <section className="panel rounded p-4 sm:p-6 space-y-4">
          <h2 className="text-base font-semibold">{t("Profile")}</h2>
          <label className="block space-y-1">
            <span className="text-sm">{t("Handle")}</span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">{origin}/</span>
              <input
                className={inputClass}
                value={draft.handle}
                onChange={(e) => update({ handle: e.target.value.toLowerCase() })}
                required
              />
            </div>
          </label>
          <label className="block space-y-1">
            <span className="text-sm">{t("Display name")}</span>
            <input className={inputClass} value={draft.title} maxLength={60} onChange={(e) => update({ title: e.target.value })} required />
          </label>
          <label className="block space-y-1">
            <span className="text-sm">{t("Bio")}</span>
            <textarea className={`${inputClass} resize-none`} rows={3} maxLength={160} value={draft.bio} onChange={(e) => update({ bio: e.target.value })} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm">{t("Profile photo URL")} <span className="text-muted">{t("(optional)")}</span></span>
            <input className={inputClass} type="url" placeholder="https://" value={draft.avatarUrl} onChange={(e) => update({ avatarUrl: e.target.value })} />
          </label>
          <div className="space-y-2">
            <span className="text-sm">{t("Theme")}</span>
            <div className="flex flex-wrap gap-3">
              {(Object.keys(BIO_THEMES) as BioTheme[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => update({ theme: key })}
                  aria-pressed={draft.theme === key}
                  className={`h-12 w-20 rounded-lg border-2 text-xs font-medium capitalize ${draft.theme === key ? "border-accent" : "border-border"}`}
                  style={{ background: BIO_THEMES[key].page, color: BIO_THEMES[key].text }}
                >
                  {key}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="panel rounded p-4 sm:p-6 space-y-4">
          <h2 className="text-base font-semibold">{t("Links")}</h2>
          {draft.links.map((link, index) => (
            <div key={link.id ?? `new-${index}`} className="space-y-2 rounded border border-border p-3">
              <input className={inputClass} placeholder={t("Title")} value={link.title} maxLength={80} onChange={(e) => updateLink(index, { title: e.target.value })} required />
              <input className={inputClass} type="url" placeholder="https://" value={link.url} onChange={(e) => updateLink(index, { url: e.target.value })} required />
              <div className="flex flex-wrap items-center gap-2">
                <label className="mr-auto flex items-center gap-2 text-xs text-muted">
                  <input type="checkbox" checked={link.isActive} onChange={(e) => updateLink(index, { isActive: e.target.checked })} />
                  {t("Visible")}
                  {link.clicks !== undefined ? <span>· {t("{count} clicks", { count: link.clicks })}</span> : null}
                </label>
                <button type="button" className={smallButton} disabled={index === 0} onClick={() => moveLink(index, -1)} aria-label={t("Move up")}>↑</button>
                <button type="button" className={smallButton} disabled={index === draft.links.length - 1} onClick={() => moveLink(index, 1)} aria-label={t("Move down")}>↓</button>
                <button type="button" className={smallButton} onClick={() => update({ links: draft.links.filter((_, i) => i !== index) })}>{t("Remove")}</button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="w-full rounded-lg border border-border py-2 text-sm text-muted hover:text-foreground"
            onClick={() => update({ links: [...draft.links, { title: "", url: "", isActive: true }] })}
          >
            {t("+ Add A Link")}
          </button>
        </section>

        <section className="panel rounded p-4 sm:p-6 flex flex-wrap items-center gap-3">
          <label className="mr-auto flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.isPublished} onChange={(e) => update({ isPublished: e.target.checked })} />
            {t("Published")}
          </label>
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" className={smallButton}>{t("View page")}</a>
          <button type="button" className={smallButton} onClick={() => void navigator.clipboard?.writeText(publicUrl)}>{t("Copy")}</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded text-sm font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-50">
            {saving ? t("Saving...") : t("Save")}
          </button>
        </section>
      </fieldset>

      {message ? (
        <p role="status" className={`text-sm ${message.ok ? "text-success" : "text-error"}`}>{message.text}</p>
      ) : null}
    </form>
  );
}
