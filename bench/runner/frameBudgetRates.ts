// What the whole-frame budget of the boss's case (`frameBudget.ts`, #1369) prices its counts at,
// and the per-pixel accesses it counts where no counter walks the shipped shader.
import { LIGHT_SETTINGS } from '../../packages/sdk-core/src/index.ts';
import { hizLevelSizes } from '../../packages/sdk-browser/src/gpu/hiz/levelSizes.ts';
import { benchLights } from './lamps.ts';
import { LIGHTING_RATES } from './lightGridCount.ts';
import { ATRIUM_BOUNDS } from './lightTileAtrium.ts';
import type { Light } from './lightTileCity.ts';

/** Sponza's triangles, from its glTF's index accessors (103 primitives). */
export const SPONZA_TRIANGLES = 262_267;
/** Material classes the atrium's boxes are drawn with (`materialTileCount.ts`). */
export const CLASSES = 6;

/**
 * The rates, each from a measured number:
 * - `texelPs`: the lighting model's texel rate (`LIGHTING_RATES`), MODELLED: every per-pixel access.
 * - `trianglePs`: a triangle drawn into the visibility buffer, UE5's Nanite raster on PS5 — main and
 *   post pass, 1,148 + 183 µs for 25 million triangles —: a reference's rate.
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
/** The PCF's depth gathers a shadow read: its taps (`PCF_TAPS_WGSL`). */
export const PCF_GATHERS = LIGHT_SETTINGS.pcfTaps;
/** Page-table accesses the marking pass spends a light it marks: its home page and the PCF's
 *  neighbours across a page edge (`vsm/markingWgsl.ts`). */
export const DEMAND_MARKS = 4;

export const UNCOUNTED = [
  'shadow pages drawn: none in the steady state of a moving camera and still lamps (#1363 made the marks stable); a lamp that moves redraws its pages',
  'the shadow passes that run per frame whatever is drawn: cull, page pyramids, occlusion (the recette timed the shadow stage at 12.1–13.0 ms before #1363)',
  'selection and partition of the clusters: a few thousand clusters a frame',
  'the CPU: the recette timed it at 1.8 ms p50 on this case',
];

/** Texel reads and writes of the Hi-Z pyramid of a `width` × `height` depth (`hizLevelSizes`): the
 *  copy of level 0, then four reads and one write a texel of every coarser level. */
export const hizAccesses = (width: number, height: number) =>
  hizLevelSizes(width, height)
    .slice(1)
    .reduce((total, [w, h]) => total + 5 * w * h, 2 * width * height);

/** The bench's 200 lamps over the atrium's footprint (`benchLights`), as the grid sees them. */
export function atriumBenchLamps(): Light[] {
  const plan = benchLights(ATRIUM_BOUNDS, { lights: 200, lightShadows: true, sun: false });
  return (plan?.lights ?? []).map((light) => ({
    centre: (light.position ?? [0, 0, 0]).map(Math.fround) as Light['centre'],
    radius: Math.fround(light.range ?? 0),
  }));
}
