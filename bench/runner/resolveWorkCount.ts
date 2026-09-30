// What the deferred resolve of a MOVING image spends per covered pixel beyond its G-buffer reads
// (#1369), develop against this branch: the tile lists of the tile pass's oracle, each pixel's point
// against each listed light's range. COUNTED, never timed; upper bounds where a term depends on a
// weight or a facing the atrium does not model.
//
// - `setup`: the pixels that set up a shadow read — eight neighbour depths for the unjittered
//   footprint and the receiver offset recomputed from the visibility buffer (`shadowSetup`, #1410):
//   develop at every lit pixel, now where the tile's list holds a shadowed light (`pixelShadowed`).
// - `weights`: `lightWeight` evaluations of a drawn list (`sampledTileLighting`): three walks of
//   its `L` lights on develop, two now.
// - `shaded`: lights shaded in full (`declaredLight`): a full sum's `L`, a drawn list's at most
//   `LIGHT_SAMPLES`.
// - `shadows`: shadow reads, at most the shaded lights holding a slot that reach the pixel.
// - `gathers`: depth gathers of those reads (`shadowPcf`): 16 each on develop, `MOVING_PCF_TAPS` now.
//
//   node bench/runner/resolveWorkCount.ts [--width 3456] [--height 2234] [--slots 64]
import { parseArgs } from 'node:util';
import { LIGHT_SETTINGS } from '../../packages/sdk-core/src/index.ts';
import { MOVING_PCF_TAPS } from '../../packages/sdk-browser/src/lighting/direct/pcfTaps.ts';
import {
  camera,
  pixelPoint,
} from '../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import {
  sliceHits,
  toTileFrame,
  type TileView,
} from '../oracles/browser/gpuLightTileColumnOracle.ts';
import { coveredTile } from './lightTileCount.ts';
import { ATRIUM_POSES, atriumDepth, atriumLamps } from './lightTileAtrium.ts';
import type { Light } from './lightTileCity.ts';

const SIZE = LIGHT_SETTINGS.tileSize,
  SAMPLES = LIGHT_SETTINGS.samplesPerPixel,
  LIST = LIGHT_SETTINGS.tileLights,
  TAPS = LIGHT_SETTINGS.pcfTaps;

export type Work = {
  setup: number;
  weights: number;
  shaded: number;
  shadows: number;
  gathers: number;
};
const zero = (): Work => ({ setup: 0, weights: 0, shaded: 0, shadows: 0, gathers: 0 });

/** Sums over the covered pixels of `view`, `before` (develop) and `after`; `slotted[rank]` whether
 *  a light holds a shadow slot. */
export function countResolveWork(
  view: TileView,
  depths: Float32Array,
  lights: Light[],
  slotted: boolean[],
) {
  const sums = { covered: 0, before: zero(), after: zero() };
  for (let ty = 0; ty < Math.ceil(view.height / SIZE); ty++)
    for (let tx = 0; tx < Math.ceil(view.width / SIZE); tx++) {
      const covered = coveredTile(view, [tx, ty], depths);
      if (!covered) continue;
      const { pixels, bounds } = covered;
      const listed = lights.flatMap((light, rank) =>
        sliceHits(bounds, toTileFrame(view, light.centre), light.radius).opaque ? [rank] : [],
      );
      const L = listed.length,
        flagged = listed.some((rank) => slotted[rank]),
        drawn = flagged && L > SAMPLES && L <= LIST;
      const shadowed = listed.filter((rank) => slotted[rank]).map((rank) => lights[rank]);
      for (const [x, y, z] of pixels) {
        const p = pixelPoint(view, x, y, z);
        const reaching = shadowed.filter(
          ({ centre: c, radius }) =>
            (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2 < radius ** 2,
        ).length;
        const shadows = drawn ? Math.min(SAMPLES, reaching) : reaching;
        sums.covered++;
        for (const [side, walks, taps, setup] of [
          [sums.before, 3, TAPS, true],
          [sums.after, 2, MOVING_PCF_TAPS, flagged],
        ] as const) {
          side.setup += +setup;
          side.weights += drawn ? walks * L : 0;
          side.shaded += drawn ? SAMPLES : L;
          side.shadows += shadows;
          side.gathers += shadows * taps;
        }
      }
    }
  return sums;
}

async function main() {
  const { values } = parseArgs({
    options: {
      width: { type: 'string', default: '3456' },
      height: { type: 'string', default: '2234' },
      slots: { type: 'string', default: '64' },
    },
  });
  const [width, height, slots] = [values.width, values.height, values.slots].map(Number);
  const lights = atriumLamps(200, 4);
  const rows = ATRIUM_POSES.flatMap(({ eye, yaw, pitch }, pose) => {
    const view = camera(eye, yaw, pitch, 60, width, height);
    const s = countResolveWork(
      view,
      atriumDepth(view),
      lights,
      lights.map((_, rank) => rank < slots),
    );
    return (['before', 'after'] as const).map((side) => ({
      pose,
      side,
      ...Object.fromEntries(
        Object.entries(s[side]).map(([k, v]) => [k, (v / s.covered).toFixed(2)]),
      ),
    }));
  });
  console.log(
    `Moving image, 200 lamps of range 4 m, ${slots} holding a shadow slot, ${width} × ${height}, per covered pixel:`,
  );
  console.table(rows);
}

if (import.meta.main) await main();
