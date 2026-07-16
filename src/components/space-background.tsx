"use client";

import dynamic from "next/dynamic";

/**
 * Fixed, pointer-events-none space backdrop.
 *
 * The CSS layers (nebula + two starfields + masked grid) stay as the always-on
 * base. On top of them we mount a client-only Three.js scene via `dynamic(...,
 * { ssr: false })` — `ssr: false` is required here because WebGL can't run on
 * the server, and in this Next version `next/dynamic` with `ssr: false` is only
 * allowed inside a Client Component (this file is `"use client"`).
 *
 * The 3D canvas is transparent, so the CSS nebula/starfield reads through it.
 * If WebGL is unavailable the scene self-disables and the CSS backdrop remains.
 */
const SpaceScene = dynamic(() => import("./space-scene"), { ssr: false });

export function SpaceBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      <div className="nebula" />
      <div className="starfield" />
      <div className="starfield-2" />
      <div className="grid-veil" />
      <SpaceScene />
    </div>
  );
}
