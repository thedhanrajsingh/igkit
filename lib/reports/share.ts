import { randomBytes } from "node:crypto";

export function generateReportShareSlug() {
  return randomBytes(9).toString("base64url");
}

export function buildReportUrl(slug: string, baseUrl?: string) {
  const resolvedBaseUrl =
    baseUrl ??
    (typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXTAUTH_URL ?? "http://localhost:3000");

  return `${resolvedBaseUrl.replace(/\/$/, "")}/reports/${slug}`;
}

export function isReportBranded() {
  return false;
}
