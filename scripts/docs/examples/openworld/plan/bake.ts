/**
 * One terrain tile's baked base colour (#332): a `size`² sRGB image covering the tile once, its
 * texel `(i, j)` centred on the world point `(x0 + i·step, z0 + j·step)`, `step = tile / (size −
 * 1)`. The first and last texels of a row sit on the tile's edges, so two neighbouring tiles bake
 * the same world points there, through the same functions, into the same bytes: no seam.
 *
 * Per texel: the ground's albedo (`paint.ts`), with what the erosion left there (loose ground,
 * cut rock, running water, `erosion.ts`), under a fractal noise whose finest octave is two
 * texels (the finest detail the image can hold) and whose coarsest is the tile; the roads and
 * water beds stamped over it; then the sky's occlusion. Only occlusion is baked, never the sun:
 * the engine lights the surface, and a baked sun would light it twice. The sky visible over a
 * texel is the uniform-sky view factor above its horizon in eight directions, `cos²` of each
 * horizon's elevation, read one texel away — the local slope and cavity at the image's own scale.
 */
import { WORLD } from './contract.ts';
import type { ErosionFields } from './erosion.ts';
import { fbm } from './noise.ts';
import type { GroundColour, Weathering } from './paint.ts';
import { stampPaths, type pathIndex } from './stamp.ts';
import { albedoSpread } from './surfaces.ts';
import { tileOrigin } from './tileGrid.ts';

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/** Linear to sRGB-encoded byte (IEC 61966-2-1). */
function srgb(linear: number): number {
  const c = Math.max(0, Math.min(1, linear));
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
}

export type BakedTile = { rgba: Uint8Array; roughness: number };

export function bakeTile(
  height: (x: number, z: number) => number,
  erosion: ErosionFields,
  colour: GroundColour,
  paths: ReturnType<typeof pathIndex>,
  seed: number,
  tx: number,
  tz: number,
  size: number,
): BakedTile {
  const step = WORLD.tile / (size - 1),
    x0 = tileOrigin(tx),
    z0 = tileOrigin(tz),
    apron = size + 2,
    heights = new Float64Array(apron * apron),
    octaves = Math.max(1, Math.floor(Math.log2((size - 1) / 2))),
    { cover, surface } = stampPaths(paths(tx, tz), x0, z0, size, step),
    rgba = new Uint8Array(size * size * 4),
    albedo = new Float64Array(4),
    weathering: Weathering = { loose: 0, cut: 0, wet: 0 },
    whole = (depth: number) => Math.min(1, depth / erosion.layer);
  for (let j = -1; j <= size; j++)
    for (let i = -1; i <= size; i++)
      heights[(j + 1) * apron + i + 1] = height(x0 + i * step, z0 + j * step);
  const at = (i: number, j: number) => heights[(j + 1) * apron + i + 1];
  let roughness = 0;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const x = x0 + i * step,
        z = z0 + j * step,
        h = at(i, j),
        dx = (at(i + 1, j) - at(i - 1, j)) / (2 * step),
        dz = (at(i, j + 1) - at(i, j - 1)) / (2 * step),
        slope = Math.atan(Math.hypot(dx, dz)) / (Math.PI / 2),
        noise = fbm(seed, x / WORLD.tile, z / WORLD.tile, octaves),
        texel = j * size + i,
        c = cover[texel],
        path = surface[texel];
      weathering.loose = whole(erosion.loose(x, z));
      weathering.cut = whole(erosion.incision(x, z));
      weathering.wet = erosion.wet(x, z);
      colour(x, z, h, slope, noise, weathering, albedo);
      if (path && c > 0) {
        const variation = 1 + albedoSpread(path) * noise;
        for (let k = 0; k < 3; k++) albedo[k] = albedo[k] * (1 - c) + path.color[k] * variation * c;
        albedo[3] = albedo[3] * (1 - c) + path.roughness * c;
      }
      let sky = 0;
      for (const [di, dj] of NEIGHBOURS) {
        const rise = Math.max(0, (at(i + di, j + dj) - h) / (step * Math.hypot(di, dj)));
        sky += 1 / (1 + rise * rise);
      }
      sky /= NEIGHBOURS.length;
      rgba.set(
        [srgb(albedo[0] * sky), srgb(albedo[1] * sky), srgb(albedo[2] * sky), 255],
        texel * 4,
      );
      roughness += albedo[3];
    }
  return { rgba, roughness: roughness / (size * size) };
}
