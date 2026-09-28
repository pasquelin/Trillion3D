// The open city of the R&D audit's light-tile model (#924, OMB-03, `t03_tiles_sim.py`), rebuilt in
// TypeScript with the repository's seeded sequence: a 40 × 40 grid of 60 m blocks, one 44 m
// building per block, 6 to 90 m high, 8 % of blocks left empty; street lamps every 20 m along both
// axes, 1,500 lit windows and 40 large lights. Synthetic: it stands for an aerial view over many
// lights, never for a scene of the repository. `depthField` ray-casts it as the engine's depth
// buffer holds it — reverse-Z, infinite far, 0 on the sky.
import { seeded } from '../../site/examples/kit/random.ts';
import {
  pixelRay,
  rayDepth,
  rayParameter,
  type Vec3,
} from '../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import type { TileView } from '../oracles/browser/gpuLightTileColumnOracle.ts';

export type Light = { centre: Vec3; radius: number };
/** `blocks`: each block's building height by `blockIndex`, 0 for an empty block. */
export type City = { blocks: Uint8Array; lights: Light[] };

const BLOCK = 60,
  HALF = 20,
  SIDE = 2 * HALF,
  EXTENT = HALF * BLOCK,
  BUILDING = 44,
  INSET = 8;
/** The audit's heights and their weights. */
const HEIGHTS = [6, 12, 20, 35, 60, 90],
  WEIGHTS = [0.15, 0.3, 0.25, 0.15, 0.1, 0.05];
/** Past this view distance a pixel is sky, as in the audit's model. */
const SKY_DISTANCE = 4000;

/** Where block `i`, `j` (each in [−HALF, HALF)) keeps its height in `City.blocks`. */
export const blockIndex = (i: number, j: number) => (i + HALF) * SIDE + (j + HALF);
export const emptyBlocks = () => new Uint8Array(SIDE * SIDE);

/** A light as the GPU stores it: centre and range in f32. */
const light = (centre: Vec3, radius: number): Light => ({
  centre: centre.map(Math.fround) as Vec3,
  radius: Math.fround(radius),
});

export function buildCity(seed = 42): City {
  const r = seeded(seed),
    u = (lo: number, hi: number) => lo + (hi - lo) * r();
  const blocks = emptyBlocks();
  for (let i = -HALF; i < HALF; i++)
    for (let j = -HALF; j < HALF; j++) {
      if (r() < 0.08) continue; // a square
      let pick = r(),
        k = 0;
      while (k < HEIGHTS.length - 1 && (pick -= WEIGHTS[k]) >= 0) k++;
      blocks[blockIndex(i, j)] = HEIGHTS[k];
    }
  const lights: Light[] = [];
  for (let i = -HALF; i < HALF; i++)
    for (let k = 0; k < 3; k++)
      for (let j = -HALF; j < HALF; j++) {
        const [x, z] = [i * BLOCK + 4, j * BLOCK + k * 20];
        lights.push(light([x, 6, z], u(12, 20)));
        lights.push(light([z, 6, x], u(12, 20)));
      }
  const scatter = (count: number, y: [number, number], radius: [number, number]) => {
    for (let n = 0; n < count; n++)
      lights.push(light([u(-EXTENT, EXTENT), u(...y), u(-EXTENT, EXTENT)], u(...radius)));
  };
  scatter(1500, [2, 60], [4, 10]); // windows
  scatter(40, [10, 40], [40, 80]); // large lights
  return { blocks, lights };
}

/** The parameters where the ray `o + s·d` enters and leaves the box: entry past exit on a miss. */
function slab(o: Vec3, d: Vec3, lo: Vec3, hi: Vec3) {
  let near = -Infinity,
    far = Infinity;
  for (let a = 0; a < 3; a++) {
    const inv = 1 / d[a],
      t1 = (lo[a] - o[a]) * inv,
      t2 = (hi[a] - o[a]) * inv;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
  }
  return [near, far];
}

/** The ray parameter where it leaves its cell `k` along axis `a`, Infinity when parallel. */
function wallExit(o: Vec3, d: Vec3, a: number, k: number) {
  return d[a] === 0 ? Infinity : ((k + (d[a] > 0 ? 1 : 0)) * BLOCK - o[a]) / d[a];
}

/** First hit of the ray on the city: the ground y = 0 or a building, walking the blocks it
 *  crosses in order, so the first building hit is the nearest. */
function castRay(city: City, o: Vec3, d: Vec3, limit: number) {
  const ground = d[1] < 0 ? -o[1] / d[1] : Infinity;
  const end = Math.min(ground, limit);
  const [enter, leave] = slab(o, d, [-EXTENT, -1, -EXTENT], [EXTENT, 91, EXTENT]);
  let s = enter <= leave ? Math.max(enter, 0) : Infinity;
  while (s < end) {
    const i = Math.floor((o[0] + d[0] * (s + 1e-9)) / BLOCK),
      j = Math.floor((o[2] + d[2] * (s + 1e-9)) / BLOCK);
    const height =
      i >= -HALF && i < HALF && j >= -HALF && j < HALF ? city.blocks[blockIndex(i, j)] : 0;
    if (height) {
      const lo: Vec3 = [i * BLOCK + INSET, 0, j * BLOCK + INSET];
      // As the audit's model: a building is hit from outside only, an eye inside one sees out.
      const [hit, out] = slab(o, d, lo, [lo[0] + BUILDING, height, lo[2] + BUILDING]);
      if (hit > 0 && hit <= out && hit < end) return hit;
    }
    // Leave the cell by its nearest wall along x or z.
    const next = Math.min(wallExit(o, d, 0, i), wallExit(o, d, 2, j));
    if (!(next > s) || Math.abs(i) > HALF || Math.abs(j) > HALF) break;
    s = next;
  }
  return ground < limit ? ground : Infinity;
}

/** The depth buffer of `view` over the city, row by row: NEAR / distance in f32, 0 on the sky. */
export function depthField(city: City, view: TileView) {
  const depths = new Float32Array(view.width * view.height);
  const limit = rayParameter(SKY_DISTANCE);
  for (let py = 0; py < view.height; py++)
    for (let px = 0; px < view.width; px++) {
      const { o, d } = pixelRay(view, px, py);
      const s = castRay(city, o, d, limit);
      depths[py * view.width + px] = s === Infinity ? 0 : rayDepth(s);
    }
  return depths;
}
