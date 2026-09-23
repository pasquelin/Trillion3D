/**
 * The desert's surfaces and the ground the terrain paints with them: dune sand on every slope
 * sand can hold, and on steeper rock horizontal strata by altitude — ochre, rust, cream and red,
 * each band as thick as a formation. Strata are horizontal in the world, not along each mesa, so
 * one band runs across every cliff at the same height, as sedimentary beds do.
 */
import type { GroundLayer, Surface } from '../../plan/contract.ts';
import { card, glow, hash01, surface } from '../../props/index.ts';
import { FIELD_SEED } from './field.ts';
import { STRATUM } from './landforms.ts';

/** Linear RGB from an sRGB colour written 0–255 (how a colour picker states it). */
export const srgb = (r: number, g: number, b: number): [number, number, number] =>
  [r, g, b].map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

const matte = (name: string, rgb: readonly [number, number, number], roughness = 0.95) =>
  surface(`desert/${name}`, rgb, 0, roughness);

export const DESERT = {
  sand: matte('sand', srgb(214, 170, 118)),
  ochre: matte('ochre', srgb(196, 124, 58)),
  rust: matte('rust', srgb(160, 66, 32)),
  cream: matte('cream', srgb(226, 204, 160)),
  red: matte('red', srgb(142, 48, 30)),
  darkRock: matte('dark-rock', srgb(92, 58, 44)),
  mudBrick: matte('mud-brick', srgb(186, 134, 92)),
  mudPlaster: matte('mud-plaster', srgb(208, 170, 128)),
  limewash: matte('limewash', srgb(232, 222, 202), 0.85),
  palmWood: matte('palm-wood', srgb(96, 70, 44)),
  cactus: matte('cactus', srgb(62, 96, 58), 0.7),
  succulent: matte('succulent', srgb(98, 132, 104), 0.6),
  dryBrush: matte('dry-brush', srgb(128, 110, 76)),
  deadWood: matte('dead-wood', srgb(140, 124, 104)),
  tileBlue: surface('desert/tile-blue', srgb(34, 96, 140), 0, 0.3),
  domeCopper: surface('desert/dome-copper', srgb(70, 140, 120), 0.6, 0.45),
  water: surface('desert/water', srgb(20, 70, 80), 0, 0.05),
  awningRed: card('desert/awning-red', srgb(170, 40, 30)),
  awningStripe: card('desert/awning-stripe', srgb(230, 214, 170)),
  frondShade: card('desert/frond-shade', srgb(128, 110, 76), 0.95),
  forecourtRed: surface('desert/forecourt-red', srgb(180, 30, 24), 0.3, 0.45),
  truckCab: surface('desert/truck-cab', srgb(30, 70, 130), 0.5, 0.4),
  trailer: surface('desert/trailer', srgb(220, 220, 214), 0.3, 0.5),
  chrome: surface('desert/chrome', srgb(200, 200, 205), 1, 0.15),
  signLight: glow('desert/sign-light', [1, 0.86, 0.6], 6),
  neonRed: glow('desert/neon-red', [1, 0.1, 0.06], 10),
  canopyLight: glow('desert/canopy-light', [1, 0.97, 0.9], 14),
  lantern: glow('desert/lantern', [1, 0.6, 0.25], 8),
} as const satisfies Record<string, Surface>;

/** The strata colours, bottom to top of a repeating sequence (rust twice: the commonest bed). */
export const STRATA = [DESERT.red, DESERT.rust, DESERT.ochre, DESERT.cream, DESERT.rust] as const;

/**
 * Horizontal bands from the sea to `top` metres: each one stratum thick give or take half, its
 * colour drawn from the sequence so neighbours differ.
 */
function strata(top: number): GroundLayer[] {
  const layers: GroundLayer[] = [];
  let y = 0,
    colour = 0;
  for (let k = 0; y < top; k++) {
    const thick = STRATUM * (0.5 + hash01(FIELD_SEED + 41, k));
    colour = (colour + 1 + Math.floor(hash01(FIELD_SEED + 42, k) * 3)) % 4;
    layers.push({ surface: STRATA[colour], minHeight: y, maxHeight: y + thick });
    y += thick;
  }
  return layers;
}

/**
 * Ground layers, first match wins. Slope is the ground's angle over 90° (0 flat, 1 wall): sand
 * holds up to its angle of repose, 34°; steeper ground is bare rock.
 */
export const DESERT_GROUND: readonly GroundLayer[] = [
  { surface: DESERT.sand, maxSlope: 34 / 90 },
  ...strata(2000),
  { surface: DESERT.darkRock },
];
