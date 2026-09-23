/**
 * The city's own surfaces, named `city/…` so they never collide with the shared palette. Glass
 * tints give each tower archetype its colour; lit windows and neon tubes are emissive, and the
 * page dims them by day through its material overrides.
 */
import { ALBEDO, ground } from '../../plan/surfaces.ts';
import { glow, surface } from '../../props/index.ts';

export const CITY = {
  glassBlue: surface('city/glass-blue', [0.03, 0.08, 0.14], 0.3, 0.05),
  glassTeal: surface('city/glass-teal', [0.02, 0.1, 0.09], 0.3, 0.05),
  glassBronze: surface('city/glass-bronze', [0.09, 0.06, 0.03], 0.4, 0.06),
  glassSilver: surface('city/glass-silver', [0.16, 0.17, 0.19], 0.6, 0.04),
  glassDark: surface('city/glass-dark', [0.02, 0.02, 0.025], 0.2, 0.05),
  mullion: surface('city/mullion', [0.55, 0.56, 0.58], 1, 0.3),
  mullionDark: surface('city/mullion-dark', [0.05, 0.05, 0.06], 0.9, 0.35),
  spandrel: surface('city/spandrel', [0.2, 0.21, 0.23], 0.5, 0.4),
  stone: surface('city/limestone', [0.62, 0.57, 0.48], 0, 0.8),
  granite: surface('city/granite', [0.16, 0.15, 0.15], 0, 0.55),
  render: surface('city/render-cream', [0.7, 0.64, 0.52], 0, 0.9),
  renderTerracotta: surface('city/render-terracotta', [0.5, 0.22, 0.12], 0, 0.9),
  renderGrey: surface('city/render-grey', [0.45, 0.46, 0.47], 0, 0.9),
  siding: surface('city/siding', [0.72, 0.74, 0.7], 0, 0.8),
  sidingBlue: surface('city/siding-blue', [0.3, 0.4, 0.52], 0, 0.8),
  window: surface('city/window', [0.03, 0.04, 0.05], 0.2, 0.1),
  frame: surface('city/window-frame', [0.85, 0.85, 0.82], 0, 0.5),
  railing: surface('city/railing', [0.12, 0.13, 0.14], 0.8, 0.4),
  paving: surface('city/paving', [0.36, 0.35, 0.33], 0, 0.85),
  kerb: surface('city/kerb', [0.55, 0.54, 0.51], 0, 0.8),
  zebra: surface('city/zebra', [0.85, 0.85, 0.83], 0, 0.6),
  // The lawn's brightness is Oke's albedo range for short grass (`plan/surfaces.ts`).
  lawn: ground('city/lawn', [0.07, 0.19, 0.04], ALBEDO.longToShortGrass, 0.9),
  pitch: surface('city/pitch', [0.05, 0.22, 0.04], 0, 0.85),
  seat: surface('city/seat-red', [0.45, 0.04, 0.04], 0, 0.6),
  water: surface('city/fountain-water', [0.05, 0.12, 0.16], 0.1, 0.05),
  gravel: surface('city/gravel', [0.5, 0.45, 0.38], 0, 1),
  helipad: surface('city/helipad', [0.12, 0.13, 0.13], 0, 0.7),
  heliMark: surface('city/helipad-mark', [0.8, 0.7, 0.1], 0, 0.6),
  tank: surface('city/tank-wood', [0.3, 0.2, 0.12], 0, 0.9),
  aircon: surface('city/aircon', [0.6, 0.61, 0.6], 0.6, 0.5),
  quay: surface('city/quay', [0.38, 0.37, 0.35], 0, 0.95),
  fender: surface('city/fender', [0.03, 0.03, 0.03], 0, 0.9),
  warehouse: surface('city/warehouse', [0.3, 0.33, 0.36], 0.6, 0.5),
  brickStack: surface('city/brick-stack', [0.32, 0.12, 0.07], 0, 0.9),
  windowLit: glow('city/window-lit', [1, 0.78, 0.5], 3),
  officeLit: glow('city/office-lit', [0.82, 0.9, 1], 2.5),
  aviation: glow('city/aviation-red', [1, 0.04, 0.02], 10),
  neonPink: glow('city/neon-pink', [1, 0.1, 0.55], 14),
  neonCyan: glow('city/neon-cyan', [0.1, 0.9, 1], 14),
  neonAmber: glow('city/neon-amber', [1, 0.55, 0.05], 14),
  neonGreen: glow('city/neon-green', [0.2, 1, 0.25], 14),
  floodlight: glow('city/floodlight', [1, 0.97, 0.9], 20),
} as const;
