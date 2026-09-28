// The open city of the R&D audit's light-tile model (#924, OMB-03, `t03_tiles_sim.py`), rebuilt in
// TypeScript with the repository's seeded sequence: a 40 × 40 grid of 60 m blocks, one 44 m
// building per block, 6 to 90 m high, 8 % of blocks left empty; street lamps every 20 m along both
// axes, 1,500 lit windows and 40 large lights. Synthetic: it stands for an aerial view over many
// lights, never for a scene of the repository. `depthField` ray-casts it as the engine's depth
// buffer holds it — reverse-Z, infinite far, 0 on the sky.
import { seeded } from '../../site/examples/kit/random.ts';
import {
  NEAR,
  pixelPoint,
  type Vec3,
} from '../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import type { TileView } from '../oracles/browser/gpuLightTileColumnOracle.ts';

export type Light = { centre: Vec3; radius: number };
export type City = { blocks: Map<string, number>; lights: Light[] };

const BLOCK = 60,
  HALF = 20,
  BUILDING = 44,
  INSET = 8;
/** The audit's heights and their weights. */
const HEIGHTS = [6, 12, 20, 35, 60, 90],
  WEIGHTS = [0.15, 0.3, 0.25, 0.15, 0.1, 0.05];
/** Past this view distance a pixel is sky, as in the audit's model. */
export const SKY_DISTANCE = 4000;
/** The view distance of the depth the rays are cast to: z = NEAR / FAR_CAST. */
const FAR_CAST = 1e5;

export function buildCity(seed = 42): City {
  const r = seeded(seed),
    u = (lo: number, hi: number) => lo + (hi - lo) * r();
  const blocks = new Map<string, number>();
  for (let i = -HALF; i < HALF; i++)
    for (let j = -HALF; j < HALF; j++) {
      if (r() < 0.08) continue; // a square
      let pick = r(),
        k = 0;
      while (k < HEIGHTS.length - 1 && (pick -= WEIGHTS[k]) >= 0) k++;
      blocks.set(`${i},${j}`, HEIGHTS[k]);
    }
  const lights: Light[] = [];
  for (let i = -HALF; i < HALF; i++)
    for (let k = 0; k < 3; k++)
      for (let j = -HALF; j < HALF; j++) {
        const [x, z] = [i * BLOCK + 4, j * BLOCK + k * 20];
        lights.push({ centre: [x, 6, z], radius: u(12, 20) });
        lights.push({ centre: [z, 6, x], radius: u(12, 20) });
      }
  const extent = HALF * BLOCK;
  const scatter = (count: number, y: [number, number], radius: [number, number]) => {
    for (let n = 0; n < count; n++)
      lights.push({
        centre: [u(-extent, extent), u(...y), u(-extent, extent)],
        radius: u(...radius),
      });
  };
  scatter(1500, [2, 60], [4, 10]); // windows
  scatter(40, [10, 40], [40, 80]); // large lights
  for (const light of lights) light.centre = light.centre.map(Math.fround) as Vec3;
  return { blocks, lights: lights.map((l) => ({ ...l, radius: Math.fround(l.radius) })) };
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

/** First hit of the ray on the city: the ground y = 0 or a building, walking the blocks it
 *  crosses in order, so the first building hit is the nearest. */
function castRay(city: City, o: Vec3, d: Vec3, limit: number) {
  const ground = d[1] < 0 ? -o[1] / d[1] : Infinity;
  const end = Math.min(ground, limit);
  const cell = (s: number) => o.map((v, a) => Math.floor((v + d[a] * s) / BLOCK));
  const extent = HALF * BLOCK;
  const [enter, leave] = slab(o, d, [-extent, -1, -extent], [extent, 91, extent]);
  let s = enter <= leave ? Math.max(enter, 0) : Infinity;
  while (s < end) {
    const [i, , j] = cell(s + 1e-9);
    const height = city.blocks.get(`${i},${j}`);
    if (height !== undefined) {
      const lo: Vec3 = [i * BLOCK + INSET, 0, j * BLOCK + INSET];
      // As the audit's model: a building is hit from outside only, an eye inside one sees out.
      const [hit, out] = slab(o, d, lo, [lo[0] + BUILDING, height, lo[2] + BUILDING]);
      if (hit > 0 && hit <= out && hit < end) return hit;
    }
    // Leave the cell by its nearest wall along x or z.
    const exit = [0, 2].map((a) => {
      if (d[a] === 0) return Infinity;
      const wall = ((a ? j : i) + (d[a] > 0 ? 1 : 0)) * BLOCK;
      return (wall - o[a]) / d[a];
    });
    const next = Math.min(...exit);
    if (!(next > s) || Math.abs(i) > HALF || Math.abs(j) > HALF) break;
    s = next;
  }
  return ground < limit ? ground : Infinity;
}

/** The depth buffer of `view` over the city, row by row: NEAR / distance in f32, 0 on the sky. */
export function depthField(city: City, view: TileView) {
  const depths = new Float32Array(view.width * view.height);
  const limit = (SKY_DISTANCE - NEAR) / (FAR_CAST - NEAR);
  for (let py = 0; py < view.height; py++)
    for (let px = 0; px < view.width; px++) {
      const near = pixelPoint(view, px, py, 1),
        far = pixelPoint(view, px, py, NEAR / FAR_CAST);
      const s = castRay(city, near, [0, 1, 2].map((a) => far[a] - near[a]) as Vec3, limit);
      depths[py * view.width + px] = s === Infinity ? 0 : NEAR / (NEAR + s * (FAR_CAST - NEAR));
    }
  return depths;
}
