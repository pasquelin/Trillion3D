/**
 * The floodlight mast the stadium and the quays share, and the lamps declared on it.
 */
import type { PropMesh } from '../../plan/contract.ts';
import { box, cylinder, prop, SURFACES, transform, type PropLamp } from '../../props/index.ts';
import { CITY } from './surfaces.ts';

/** A 30 m floodlight mast: a tapered pole, a frame of four lamps aimed down and forward (+Z). */
export function floodMast(): PropMesh {
  const heads = [-1.5, -0.5, 0.5, 1.5].map((x) =>
    transform(box(CITY.floodlight, [0.8, 0.6, 0.15]), { at: [x, 29.2, 0.6], pitch: 0.6 }),
  );
  return prop('city/flood-mast', [
    cylinder(SURFACES.steel, 0.45, 30, { top: 0.25, segments: 12 }),
    transform(box(SURFACES.darkMetal, [4.2, 1.6, 0.3]), { at: [0, 29, 0.3] }),
    ...heads,
  ]);
}

/** The mast's four lamps, lit at night: ≈ 46 000 lm each into a 0.5 rad cone (0.77 sr), aimed 35° down along +Z. */
export const FLOOD_LAMPS: readonly PropLamp[] = [-1.5, -0.5, 0.5, 1.5].map((x, i) => ({
  id: `flood-${i}`,
  type: 'spot',
  offset: [x, 29.5, 0.8],
  direction: [0, -0.57, 0.82],
  cone: 0.5,
  color: [1, 0.96, 0.88],
  intensity: 60_000,
  range: 180,
  night: true,
}));
