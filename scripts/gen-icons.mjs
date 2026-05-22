// Generates the pink-anchor master icon at src-tauri/icons/source.png.
// After this runs, hand the result to `pnpm tauri icon` to fan it out
// into the platform-specific sizes Tauri's bundler needs:
//
//   node scripts/gen-icons.mjs
//   pnpm tauri icon src-tauri/icons/source.png
//
// Tweak the SVG below + re-run if you want to iterate on the brand.

import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../src-tauri/icons/source.png");

// 1024×1024 SVG. Hot-pink gradient background, off-white anchor on top.
// Anchor uses Lucide's `anchor` path verbatim (24×24 viewBox), scaled up.
const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"  stop-color="#ff8fdb"/>
      <stop offset="55%" stop-color="#ff5fb5"/>
      <stop offset="100%" stop-color="#a8326f"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.45" r="0.55">
      <stop offset="0%"  stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="8"/>
      <feOffset dx="0" dy="6" result="off"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.45"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="1024" height="1024" rx="220" ry="220" fill="url(#bg)"/>
  <rect width="1024" height="1024" rx="220" ry="220" fill="url(#glow)"/>

  <!-- Anchor: Lucide's path data scaled & centered.  24-unit viewBox * 36 ≈ 864.
       Translate to (80, 80) leaves a 32-unit margin on all sides. -->
  <g transform="translate(80,80) scale(36)"
     fill="none" stroke="#fff5fa" stroke-width="0.55"
     stroke-linecap="round" stroke-linejoin="round"
     filter="url(#shadow)">
    <circle cx="12" cy="5" r="3"/>
    <line x1="12" y1="22" x2="12" y2="8"/>
    <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
  </g>
</svg>
`;

const resvg = new Resvg(SVG, { fitTo: { mode: "width", value: 1024 } });
const png = resvg.render().asPng();
writeFileSync(OUT, png);
console.log(`wrote ${OUT} (${png.length.toLocaleString()} bytes)`);
console.log("next: pnpm tauri icon src-tauri/icons/source.png");
