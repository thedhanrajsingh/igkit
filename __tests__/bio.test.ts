import { readdirSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { bioPageSchema, handleSchema, RESERVED_HANDLES } from "@/lib/bio";

function routeSegments(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("[") && entry.name !== "generated")
    .flatMap((entry) =>
      entry.name.startsWith("(") ? routeSegments(path.join(dir, entry.name)) : [entry.name]
    );
}

it("reserves every top-level route so a handle cannot shadow it", () => {
  const missing = routeSegments(path.join(process.cwd(), "app")).filter(
    (segment) => !RESERVED_HANDLES.has(segment)
  );
  expect(missing).toEqual([]);
});

it("normalizes handles and rejects reserved or malformed ones", () => {
  expect(handleSchema.parse(" Creator_1 ")).toBe("creator_1");
  expect(handleSchema.safeParse("login").success).toBe(false);
  expect(handleSchema.safeParse("a.b").success).toBe(false);
});

it("only accepts http(s) link targets", () => {
  const page = { handle: "creator", title: "Creator", theme: "light", isPublished: true };
  const link = (url: string) => ({ ...page, links: [{ title: "x", url, isActive: true }] });
  expect(bioPageSchema.safeParse(link("https://example.com")).success).toBe(true);
  expect(bioPageSchema.safeParse(link("javascript:alert(1)")).success).toBe(false);
  expect(bioPageSchema.safeParse({ ...page, links: [], avatarUrl: "data:image/png;base64,x" }).success).toBe(false);
});
