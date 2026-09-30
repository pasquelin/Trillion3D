// What the whole-frame budget of the boss's case (`frameBudget.ts`, #1369) prices its counts at,
// and the per-pixel accesses it counts where no counter walks the shipped shader.
import { benchLights } from './lamps.ts';
import { LIGHTING_RATES } from './lightGridCount.ts';
import type { Light } from './lightTileCity.ts';

/** Sponza's triangles, from its glTF's index accessors (103 primitives). */
export const SPONZA_TRIANGLES = 262_267;
/** Material classes the atrium's boxes are drawn with (`materialTileCount.ts`). */
export const CLASSES = 6;

/**
 * The rates, each from a measured number:
 * - `texelPs`: a texel read or written, the TAA resolve's 1.30 ms envelope over its 19 texels a
 *   display pixel (`LIGHTING_RATES`), 8.86 ps: the MODELLED rate of every per-pixel memory access.
 * - `trianglePs`: a triangle drawn into the visibility buffer, UE5's Nanite raster on PS5 — main and
 *   post pass, 1,148 + 183 µs for 25 million triangles (docs/REFERENCE.md) —: a reference's rate.
 * - `shadedPs`, `weightPs`: a light shaded, and a light weighed or listed out of range, in the
 *   resolve's program with shadow code, timed on develop's resolve (docs/ENGINE.md, #1326): 42.3
 *   and 28.1 ps a pixel.
 */
export const FRAME_RATES = {
  texelPs: LIGHTING_RATES.texelPs,
  trianglePs: ((1148 + 183) * 1e6) / 25e6,
  shadedPs: 42.3,
  weightPs: 28.1,
};

/** Accesses of a covered pixel in the material pass, sponza's class: its visibility texel and page
 *  row, its triangle's three indices, positions, normals and texture coordinates, its three maps
 *  (base, normal, metal-roughness), its five targets (four surfaces and the texture request). */
export const SURFACE_ACCESSES = { visibility: 1, page: 1, vertex: 12, maps: 3, targets: 5 };
/** A shadow setup's texels: eight neighbour depths and the receiver offset's visibility texel,
 *  triangle indices and positions (`shadowSetup`, `receiverOffsetWgsl.ts`). */
export const SETUP_TEXELS = 8 + 7;
/** The PCF's depth gathers a shadow read (`resolveWorkCount.ts`). */
export const PCF_GATHERS = 16;
/** Page-table accesses the demand pass spends a light it marks: its home page and the PCF's
 *  neighbours across a page edge (`demandWgsl.ts`). */
export const DEMAND_MARKS = 4;

export const UNCOUNTED = [
  'shadow pages drawn: none in the steady state of a moving camera and still lamps (#1363 made the marks stable); a lamp that moves redraws its pages',
  'the shadow passes that run per frame whatever is drawn: cull, page pyramids, occlusion (the recette timed the shadow stage at 12.1–13.0 ms before #1363)',
  'selection and partition of the clusters: a few thousand clusters a frame',
  'the CPU: the recette timed it at 1.8 ms p50 on this case',
];

/** Texel reads and writes of the Hi-Z pyramid of a `width` × `height` depth: the copy of level 0,
 *  then four reads and one write a texel of every coarser level. */
export function hizAccesses(width: number, height: number) {
  let total = 2 * width * height;
  for (let w = width, h = height; w > 1 || h > 1;) {
    [w, h] = [Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2))];
    total += 5 * w * h;
  }
  return total;
}

/** The bench's 200 lamps over the atrium's footprint (`benchLights`), as the grid sees them. */
export function atriumBenchLamps(count = 200): Light[] {
  const bounds = { min: { x: -15.3, y: -0.3, z: -7.3 }, max: { x: 15.3, y: 14, z: 7.3 } };
  const plan = benchLights(bounds, { lights: count, lightShadows: true, sun: false });
  return (plan?.lights ?? []).map((light) => ({
    centre: (light.position ?? [0, 0, 0]).map(Math.fround) as Light['centre'],
    radius: Math.fround(light.range ?? 0),
  }));
}
