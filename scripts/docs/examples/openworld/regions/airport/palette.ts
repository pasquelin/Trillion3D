/**
 * The airport's own surfaces, named `airport/…`, and the ground layers its biome paints.
 * Colours are linear RGB, as glTF `baseColorFactor` states them.
 */
import type { GroundLayer } from '../../plan/contract.ts';
import { ALBEDO, ground } from '../../plan/surfaces.ts';
import { glow, surface, SURFACES } from '../../props/index.ts';

export const PAINT = {
  /** Runway paint: white, a little rougher than the asphalt's binder. */
  white: surface('airport/runway-paint', [0.78, 0.78, 0.76], 0, 0.6),
  /** Taxiway and apron paint: the aviation yellow. */
  yellow: surface('airport/taxi-yellow', [0.72, 0.45, 0.02], 0, 0.6),
  black: surface('airport/sign-black', [0.02, 0.02, 0.02], 0, 0.6),
};

export const AIRPORT = {
  aluminium: surface('airport/aluminium', [0.6, 0.62, 0.64], 1, 0.3),
  mullion: surface('airport/mullion', [0.16, 0.17, 0.19], 0.8, 0.4),
  curtain: surface('airport/curtain-glass', [0.04, 0.09, 0.12], 0.2, 0.05),
  cladding: surface('airport/cladding', [0.55, 0.57, 0.58], 0.6, 0.45),
  roofMembrane: surface('airport/roof-membrane', [0.48, 0.48, 0.46], 0, 0.85),
  floor: surface('airport/terrazzo', [0.5, 0.48, 0.44], 0, 0.3),
  carpet: surface('airport/carpet', [0.07, 0.1, 0.18], 0, 0.95),
  hangarSkin: surface('airport/hangar-skin', [0.36, 0.4, 0.42], 0.7, 0.5),
  bridgeSkin: surface('airport/bridge-skin', [0.62, 0.63, 0.62], 0.5, 0.45),
  tankWhite: surface('airport/tank-white', [0.74, 0.74, 0.7], 0.3, 0.5),
  safetyOrange: surface('airport/safety-orange', [0.8, 0.18, 0.01], 0, 0.6),
  tugYellow: surface('airport/tug-yellow', [0.75, 0.52, 0.02], 0.3, 0.5),
  sockFabric: surface('airport/sock-fabric', [0.85, 0.25, 0.02], 0, 0.9, { alpha: 'opaque' }),
  chainLink: surface('airport/chain-link', [0.35, 0.37, 0.38], 0.9, 0.5),
  seat: surface('airport/seat', [0.05, 0.05, 0.06], 0, 0.6),
};

/** Aviation lights: white runway, green threshold, red end, blue taxiway, all at night level. */
export const LIGHTS = {
  white: glow('airport/light-white', [1, 0.93, 0.8], 14),
  green: SURFACES.signalGreen,
  red: SURFACES.signalRed,
  amber: SURFACES.signalAmber,
  blue: glow('airport/light-blue', [0.05, 0.2, 1], 10),
  ceiling: glow('airport/ceiling-light', [1, 0.95, 0.85], 3),
};

/**
 * Mown airfield grass on the flat, a drier sward on the embankments, packed earth where the
 * ground turns steep. The terrain picks the first layer whose slope and height accept a point.
 */
export const GROUND: readonly GroundLayer[] = [
  {
    surface: ground('airport/mown-grass', [0.1, 0.17, 0.05], ALBEDO.longToShortGrass, 0.9),
    maxSlope: 0.12,
  },
  {
    surface: ground('airport/dry-grass', [0.2, 0.19, 0.08], ALBEDO.longToShortGrass),
    maxSlope: 0.35,
  },
  { surface: ground('airport/packed-earth', [0.22, 0.15, 0.09], ALBEDO.soil, 1) },
];
