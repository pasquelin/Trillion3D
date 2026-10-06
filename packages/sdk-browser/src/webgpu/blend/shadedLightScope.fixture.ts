import { MODEL_FLAG } from '../../scene/surfaceModel.ts';

/**
 * The random half of a light-loop test's scope, drawn in one fixed order: a surface normal, each
 * lamp's shadow shade, the cell's list, the thin subsurface and the surface model of `round`. The
 * callers add their own shadow transmission, the one their shader reads.
 */
export function shadedLightScope(
  r: () => number,
  u: (lo: number, hi: number) => number,
  K: object,
  count: number,
  items: object[],
  round: number,
) {
  const n = [u(-1, 1), u(-1, 1), u(-1, 1)],
    ln = Math.hypot(...n) || 1;
  const normal = n.map((v) => v / ln);
  const shades = items.map(() => (r() < 0.25 ? 0 : u(0, 1)));
  const scope = {
    ...K,
    directLights: { count, items },
    tileLights: [7, 7, ...[...Array(count).keys()].filter(() => r() < 0.7)],
    thinSubsurface: r() < 0.5 ? [0, 0, 0] : [u(0, 1), u(0, 1), u(0, 1)],
    surfaceModel: [2, MODEL_FLAG.diffuse, MODEL_FLAG.toon][round % 3],
    shadowReceiverOffset: [0, 0, 0],
    shadowReceiverPlane: [0, 0, 0],
    shadowBiasNormal: (vector: number[]) => vector,
    shadowFactor: (slice: number) => (slice < 0 ? 1 : shades[slice]),
  };
  return { normal, scope };
}
