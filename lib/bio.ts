import { z } from "zod";

// Public bio pages live at /<handle>, so a handle must never shadow an app
// route. __tests__/bio.test.ts fails if a new top-level route is missing here.
export const RESERVED_HANDLES = new Set([
  "api", "go", "r", "bio", "login", "invite", "reports", "templates", "terms",
  "privacy", "data-deletion", "meta-review", "verify-request", "manifest",
  "dashboard", "overview", "inbox", "campaigns", "logs", "settings",
  "diagnostics", "automations", "comment-link-automation",
  "instagram-comment-to-dm-templates", "instagram-dm-automation-agencies",
  "manychat-alternative", "admin", "static", "public", "robots", "sitemap",
]);

export const BIO_THEMES = {
  light: { page: "#ffffff", text: "#18181b", muted: "#71717a", button: "#f4f4f5", buttonText: "#18181b", border: "#e4e4e7" },
  dark: { page: "#0a0a0a", text: "#fafafa", muted: "#a1a1aa", button: "#1f1f22", buttonText: "#fafafa", border: "#2e2e33" },
  sunset: { page: "linear-gradient(160deg,#f97316,#db2777)", text: "#ffffff", muted: "#ffe4e6", button: "#ffffff", buttonText: "#9a3412", border: "transparent" },
  ocean: { page: "linear-gradient(160deg,#0ea5e9,#4f46e5)", text: "#ffffff", muted: "#e0f2fe", button: "rgba(255,255,255,0.18)", buttonText: "#ffffff", border: "rgba(255,255,255,0.35)" },
} as const;

export type BioTheme = keyof typeof BIO_THEMES;

const httpUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "Only http(s) links are allowed");

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{2,30}$/, "Use 2-30 lowercase letters, numbers or _")
  .refine((value) => !RESERVED_HANDLES.has(value), "That handle is reserved");

export const bioPageSchema = z.object({
  handle: handleSchema,
  title: z.string().trim().min(1).max(60),
  bio: z.string().trim().max(160).optional().nullable(),
  avatarUrl: httpUrl.optional().nullable().or(z.literal("")),
  theme: z.enum(Object.keys(BIO_THEMES) as [BioTheme, ...BioTheme[]]),
  isPublished: z.boolean(),
  links: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().trim().min(1).max(80),
        url: httpUrl,
        isActive: z.boolean(),
      })
    )
    .max(50),
});

export type BioPageInput = z.infer<typeof bioPageSchema>;
