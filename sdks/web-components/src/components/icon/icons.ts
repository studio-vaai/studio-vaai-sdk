import type { SVGTemplateResult } from "lit";

import { svg } from "lit";

/**
 * The icons the flow draws, inline. All on lucide's 24×24 grid with a 2px round stroke, drawn
 * by `sv-icon` in `currentColor`. To add one, copy its shapes from lucide (lucide.dev, or
 * `node_modules/lucide-react/dist/esm/icons/<name>.mjs`) under its lucide name.
 *
 * Lucide icons: ISC License, Copyright (c) 2026 Lucide Icons and Contributors.
 * Permission to use, copy, modify, and/or distribute this software for any purpose with or
 * without fee is hereby granted, provided that the above copyright notice and this permission
 * notice appear in all copies. The software is provided "as is" and the author disclaims all
 * warranties with regard to this software.
 */
export const SV_ICONS = {
  camera: svg`<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" /><circle cx="12" cy="13" r="3" />`,
  check: svg`<path d="M20 6 9 17l-5-5" />`,
  "chevron-down": svg`<path d="m6 9 6 6 6-6" />`,
  "chevron-left": svg`<path d="m15 18-6-6 6-6" />`,
  "chevron-right": svg`<path d="m9 18 6-6-6-6" />`,
  "chevron-up": svg`<path d="m18 15-6-6-6 6" />`,
  "circle-alert": svg`<circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" />`,
  download: svg`<path d="M12 15V3" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" />`,
  image: svg`<rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />`,
  eye: svg`<path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12z" /><circle cx="12" cy="12" r="3.25" />`,
  trash: svg`<path d="M3.5 6h17" /><path d="M9 6V4.5A1.5 1.5 0 0110.5 3h3A1.5 1.5 0 0115 4.5V6" /><path d="M5.5 6l1 13a2 2 0 002 2h7a2 2 0 002-2l1-13" /><path d="M10 10.5v6.5M14 10.5v6.5" />`,
  info: svg`<circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />`,
  "rotate-cw": svg`<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />`,
  "switch-camera": svg`<path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" /><path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" /><circle cx="12" cy="12" r="3" /><path d="m18 22-3-3 3-3" /><path d="m6 2 3 3-3 3" />`,
  x: svg`<path d="M18 6 6 18" /><path d="m6 6 12 12" />`,

  /* Ours, not lucide: the garment-style toggle. A shirt worn buttoned up, and worn open. */
  "shirt-buttoned": svg`<path d="M8 4 5 6 3.5 20.5h17L19 6l-3-2" /><path d="m8 4 4 6 4-6" /><path d="M12 10v10.5" /><circle cx="12" cy="12.6" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="16.2" r="1" fill="currentColor" stroke="none" />`,
  "shirt-open": svg`<path d="M8 4 5 6 3.5 20.5h17L19 6l-3-2" /><path d="M8 4c.6 5.5 1.4 11 2.6 16.5" /><path d="M16 4c-.6 5.5-1.4 11-2.6 16.5" /><path d="m8 4 2.4 3.6L12 4.3l1.6 3.3L16 4" /><circle cx="14.6" cy="12.4" r="1" fill="currentColor" stroke="none" /><circle cx="14.1" cy="16" r="1" fill="currentColor" stroke="none" />`,
} as const satisfies Record<string, SVGTemplateResult>;
