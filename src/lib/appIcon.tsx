import { ImageResponse } from "next/og";

/** The app icon: the steering-wheel mark on brand red. Rendered to PNG at any size. */
export function appIcon(size: number) {
  const s = size;
  return new ImageResponse(
    (
      <div
        style={{
          width: s,
          height: s,
          background: "#DC2626",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width={s * 0.62} height={s * 0.62} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12.6" r="2.3" />
          <path d="M3.6 11.2c2.6-.9 5.4-1.3 8.4-1.3s5.8.4 8.4 1.3M9.9 13.6L7.4 19.2M14.1 13.6l2.5 5.6" />
        </svg>
      </div>
    ),
    { width: s, height: s },
  );
}
