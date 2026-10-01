const HEX_32_BYTE = /^[a-f0-9]{64}$/i;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

export function getBaseUrl(): string {
  return process.env.NEXTAUTH_URL ?? "http://localhost:3000";
}

export function getEncryptionKeyHex(): string {
  const value = requireEnv("ENCRYPTION_KEY");
  if (!HEX_32_BYTE.test(value)) {
    throw new Error("ENCRYPTION_KEY must be a 32-byte hex string");
  }
  return value;
}

// Checked up front so a half-filled .env reports variable names instead of an
// unhandled throw from requireEnv() mid OAuth.
const INSTAGRAM_OAUTH_ENV = [
  "INSTAGRAM_APP_ID",
  "INSTAGRAM_APP_SECRET",
  "ENCRYPTION_KEY",
  "NEXTAUTH_SECRET",
] as const;

export function getMissingInstagramOAuthEnv(): string[] {
  return INSTAGRAM_OAUTH_ENV.filter((name) => {
    const value = process.env[name];
    if (!value) return true;
    // A malformed key would otherwise fail in encryptToken after the Meta round trip.
    return name === "ENCRYPTION_KEY" && !HEX_32_BYTE.test(value);
  });
}

export function getMetaGraphApiVersion(): string {
  return process.env.META_GRAPH_API_VERSION ?? "v25.0";
}

// The only host where sign-in is blocked; a self-hoster's domain must never
// match. Keep in sync with components/demo-notice.tsx.
export const DEMO_HOST = "demo.igkit.invalid";

// Reads the Host header, not an env var, so a self-hosted deployment never
// inherits demo behavior by copying this repo's env.
export async function isPublicDemoHost(): Promise<boolean> {
  const { headers } = await import("next/headers");
  const host = (await headers()).get("host") ?? "";
  return host.split(":")[0].toLowerCase() === DEMO_HOST;
}

// Optional ALLOWED_EMAILS allowlist; otherwise anyone can sign up via magic link.
export function isEmailAllowedToSignIn(
  email: string | null | undefined
): boolean {
  const allowed = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length === 0) return true;
  if (!email) return false;
  return allowed.includes(email.toLowerCase());
}
