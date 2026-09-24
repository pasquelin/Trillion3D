/**
 * The shared surface palette. A surface is written once per glTF file, deduplicated by name, so
 * two props that use `SURFACES.concrete` share one material. A region that needs its own colour
 * makes it with `surface`, under a name of its own (`'city/facade-ochre'`).
 * Colours are linear-space base colours, as glTF `baseColorFactor` states them.
 */
import type { Rgba, Surface } from '../plan/contract.ts';

/** A surface: name, linear RGB, then metalness, roughness and any other field. */
export function surface(
  name: string,
  [r, g, b]: readonly [number, number, number],
  metalness = 0,
  roughness = 0.8,
  extra: Partial<Omit<Surface, 'name' | 'color'>> = {},
): Surface {
  const color: Rgba = [r, g, b, 1];
  return { name, color, metalness, roughness, ...extra };
}

/**
 * A thin sheet seen from both sides — a leaf, a sail, a frond — named `card/<name>`: the one
 * kind of surface the writer makes double-sided, so closed props keep back-face culling.
 */
export const card = (name: string, rgb: readonly [number, number, number], roughness = 0.8) =>
  surface(`card/${name}`, rgb, 0, roughness);

/** Whether a surface is drawn from both sides: a card, or anything not opaque. */
export const isDoubleSided = (s: Surface) =>
  s.name.startsWith('card/') || (s.alpha ?? 'opaque') !== 'opaque';

/** Throws when `next` reuses `known`'s name with other values: a name is one material. */
export function assertSameSurface(known: Surface, next: Surface) {
  if (known !== next && JSON.stringify(known) !== JSON.stringify(next))
    throw new Error(`two different surfaces are named "${next.name}"`);
}

/**
 * A surface that glows: `emissive` colour at `strength` (`KHR_materials_emissive_strength`).
 * The page dims the day-only ones by the day cycle through its own material overrides.
 */
export const glow = (name: string, rgb: readonly [number, number, number], strength: number) =>
  surface(name, rgb, 0, 0.5, { emissive: rgb, emissiveStrength: strength });

/** A glossy car-body paint of any colour, named after it. */
export const paint = (name: string, rgb: readonly [number, number, number]) =>
  surface(`paint/${name}`, rgb, 0.6, 0.35);

export const SURFACES = {
  concrete: surface('concrete', [0.42, 0.41, 0.38], 0, 0.9),
  asphalt: surface('asphalt', [0.05, 0.05, 0.055], 0, 0.95),
  brick: surface('brick', [0.35, 0.11, 0.06], 0, 0.85),
  plaster: surface('plaster', [0.68, 0.62, 0.52], 0, 0.9),
  roofTile: surface('roof-tile', [0.3, 0.08, 0.04], 0, 0.75),
  slate: surface('slate', [0.08, 0.09, 0.11], 0, 0.7),
  glass: surface('glass', [0.05, 0.1, 0.13], 0.1, 0.08),
  wood: surface('wood', [0.25, 0.14, 0.06], 0, 0.8),
  steel: surface('steel', [0.5, 0.52, 0.55], 1, 0.35),
  paintedMetal: surface('painted-metal', [0.1, 0.18, 0.12], 0.5, 0.5),
  darkMetal: surface('dark-metal', [0.04, 0.045, 0.05], 0.8, 0.45),
  whitePaint: surface('white-paint', [0.8, 0.8, 0.78], 0.1, 0.45),
  signRed: surface('sign-red', [0.6, 0.03, 0.02], 0, 0.5),
  signBlue: surface('sign-blue', [0.02, 0.08, 0.45], 0, 0.5),
  containerRed: surface('container-red', [0.45, 0.06, 0.03], 0.4, 0.6),
  containerBlue: surface('container-blue', [0.03, 0.12, 0.35], 0.4, 0.6),
  craneYellow: surface('crane-yellow', [0.8, 0.5, 0.02], 0.4, 0.55),
  hullRed: surface('hull-red', [0.3, 0.02, 0.02], 0.2, 0.6),
  hullWhite: surface('hull-white', [0.82, 0.82, 0.8], 0.1, 0.3),
  sail: card('sail', [0.9, 0.88, 0.82], 0.9),
  rubber: surface('rubber', [0.02, 0.02, 0.02], 0, 0.9),
  bark: surface('bark', [0.12, 0.07, 0.04], 0, 0.95),
  birchBark: surface('birch-bark', [0.72, 0.7, 0.64], 0, 0.85),
  palmBark: surface('palm-bark', [0.3, 0.22, 0.12], 0, 0.95),
  leaves: card('leaves', [0.06, 0.16, 0.03]),
  birchLeaves: card('birch-leaves', [0.16, 0.3, 0.05]),
  needles: card('needles', [0.02, 0.08, 0.03], 0.85),
  palmLeaves: card('palm-leaves', [0.1, 0.25, 0.04], 0.75),
  rock: surface('rock', [0.25, 0.24, 0.22], 0, 0.95),
  sandstone: surface('sandstone', [0.55, 0.3, 0.14], 0, 0.95),
  emissiveWindow: glow('emissive-window', [1, 0.72, 0.4], 2),
  emissiveLamp: glow('emissive-lamp', [1, 0.8, 0.55], 12),
  signalRed: glow('signal-red', [1, 0.05, 0.02], 8),
  signalAmber: glow('signal-amber', [1, 0.45, 0.02], 8),
  signalGreen: glow('signal-green', [0.05, 1, 0.3], 8),
  headlight: glow('headlight', [1, 0.95, 0.85], 10),
  taillight: glow('taillight', [0.9, 0.02, 0.01], 6),
} as const satisfies Record<string, Surface>;
