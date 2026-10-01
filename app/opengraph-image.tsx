import { ImageResponse } from "next/og";

export const alt = "IGKit: open-source Instagram comment-to-DM automation";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#0b0b0c", color: "#f5f5f4" }}>
        <div style={{ fontSize: 40, fontWeight: 700, display: "flex" }}>IGKit</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.05, maxWidth: 900 }}>Comment a keyword. Get the DM.</div>
          <div style={{ fontSize: 32, color: "#a1a1a8" }}>Open-source, self-hosted ManyChat alternative for Instagram.</div>
        </div>
        <div style={{ display: "flex", height: 16, width: 240, borderRadius: 999, background: "#d9370f" }} />
      </div>
    ),
    size
  );
}
