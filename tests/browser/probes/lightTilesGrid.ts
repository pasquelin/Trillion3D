/**
 * The light grid a real tile pass wrote (#1249), decoded as the resolve decodes it: for each
 * covered pixel, its slice from its depth and the tile's two depth words (`clusterMask`), then the
 * lights its slice mask names (`sliceLighting`). `missed` counts the lights whose sphere holds the
 * pixel's point that the mask does not name — none may be —, `walked` and `listed` the lights the
 * grid and the whole tile list make the pixel walk (`light-tiles-plain-gpu.ts`).
 */
import { LIGHT_TILES_SHADER } from '../../../packages/sdk-browser/src/lighting/tiles/shader.ts';
import { wgslConstants } from '../../../packages/sdk-browser/src/texture/shaderRule.fixture.ts';
import {
  clusterRun,
  sliceMap,
} from '../../../packages/sdk-browser/src/lighting/tiles/clusterSlices.fixture.ts';
import {
  pixelPoint,
  type Vec3,
} from '../../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import type { TileView } from '../../../bench/oracles/browser/gpuLightTileColumnOracle.ts';

const K = wgslConstants(LIGHT_TILES_SHADER);
const MAP = sliceMap();
const unbits = (word: number) => new Float32Array(Uint32Array.of(word).buffer)[0];
/** `clusterDistance` of the resolve: the view distance up to the near plane's factor. */
const distance = (z: number) => 1 / Math.max(z, 1e-9);

export function gridWalks(
  words: Uint32Array,
  tilesX: number,
  view: TileView,
  depths: Float32Array,
  lights: { position: Vec3; range: number }[],
) {
  const sums = { missed: 0, walked: 0, listed: 0 };
  for (let y = 0; y < view.height; y++)
    for (let x = 0; x < view.width; x++) {
      const z = depths[y * view.width + x];
      if (!z) continue;
      const base =
        (Math.floor(y / K.TILE_SIZE) * tilesX + Math.floor(x / K.TILE_SIZE)) * K.TILE_STRIDE;
      const kept = words[base];
      const first = words[base + K.TILE_OPAQUE_BASE];
      const everyLight = kept > K.TILE_LIGHTS && first === K.TILE_NO_SLICE;
      const walked = everyLight ? lights.length : kept;
      const light = (i: number) =>
        kept <= K.TILE_LIGHTS
          ? words[base + K.TILE_OPAQUE_BASE + i]
          : everyLight
            ? i
            : words[first + i];
      const slice = MAP.clusterSliceIndex(
        distance(z),
        distance(unbits(words[base + K.TILE_DEPTH_BASE])),
        distance(unbits(words[base + K.TILE_DEPTH_BASE + 1])),
      );
      const group = clusterRun(walked);
      const named = new Set<number>();
      for (let i = 0; i < walked; i++) {
        const bit = Math.floor(i / group);
        const mask = words[base + K.TILE_CLUSTER_BASE + 2 * slice + (bit >> 5)];
        if ((mask >>> (bit & 31)) & 1) named.add(light(i));
      }
      sums.walked += named.size;
      sums.listed += walked;
      const point = pixelPoint(view, x, y, z);
      lights.forEach(({ position, range }, rank) => {
        const reach = Math.hypot(...position.map((c, i) => c - point[i]));
        // A thousandth inside the range: the f32 pass and this f64 point may part at its edge.
        if (reach < range * 0.999 && !named.has(rank)) sums.missed++;
      });
    }
  return sums;
}
