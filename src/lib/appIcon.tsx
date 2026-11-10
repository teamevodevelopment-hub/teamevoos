import { ImageResponse } from "next/og";

/** The app icon: a rising line on the accent colour. Rendered to PNG at any size. */
export function appIcon(size: number) {
  const s = size;
  return new ImageResponse(
    (
      <div
        style={{
          width: s,
          height: s,
          background: "#3345D1",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width={s * 0.56} height={s * 0.56} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 16l5-5 4 4 7-8" />
          <path d="M15 7h5v5" />
        </svg>
      </div>
    ),
    { width: s, height: s },
  );
}
