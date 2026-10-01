// Lights each covered pixel walks against those that reach it (#1369), and the grid pass's work:
// UE5's light grid — cells of `tileSize` pixels across and `gridSlices` slices of depth,
// `gridSlicesPerOctave` to a doubling of the view depth —, the lights culled once per image against
// each cell's own bounds, each pixel walking its cell's list (`lighting/tiles`, their oracle
// `gpuLightGridOracle.ts`). `reach` counts, per pixel, the lights whose range holds its point: the
// floor no grid goes under; `missed`, those reaching it but not listed, is 0 (among the lights
// within its column's planes, which alone can reach it). Develop's tile pass beside it: its depth
// texels and tile × light tests. COUNTED, never timed.
//
// The lighting's MODEL, never a timing: the counts above priced at rates taken from measured numbers
// (`LIGHTING_RATES`).
//
//   node bench/runner/lightGridCount.ts [--width 3456] [--height 2234] [--range 4]
import { parseArgs } from 'node:util';
import { camera } from '../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import type { TileView } from '../oracles/browser/gpuLightGridOracle.ts';
import { reaches, tilePassWork, walkGrid } from './lightGridWalk.ts';
import { ATRIUM_POSES, atriumDepth, atriumLamps } from './lightTileAtrium.ts';
import type { Light } from './lightTileCity.ts';

/**
 * The rates the model prices the counts at, each from a number measured on develop:
 * - `pairNs`: the recette's 1.21 ms of develop's tile pass at 3456 × 2234, spread over its 6.048
 *   million tile × light pairs (each two slices tested, the tile's 256 depth reads and reductions
 *   folded in): 0.200 ns a light against a cell's bounds with its bookkeeping. The grid pass is
 *   charged one pair a column × light test and two a run solved (its at most eight section
 *   evaluations and two depths).
 * - `texelPs`: a texel read or written, the TAA resolve's 1.30 ms envelope over its 19 texels a
 *   display pixel (#1369's profile): 8.86 ps. The grid pass is charged two a list entry (its mark,
 *   its write) and two a cell record.
 *   The resolve is charged its G-buffer texels (`RESOLVE_GBUFFER`) at the same rate, per texel
 *   whatever its bytes: no measured number prices a byte alone, so the bytes are counted, not
 *   priced.
 * - `inRangePs`, `outOfRangePs`: a listed light in and out of the pixel's range in the resolve's
 *   program with no shadow code, timed on the resolve (64 lamps, a million pixels, M2 Max, #1326,
 *   docs/ENGINE.md): 27.8 and 10.6 ps a pixel.
 */
export const LIGHTING_RATES = {
  pairNs: 1.21e6 / 6.048e6,
  texelPs: 8.86,
  inRangePs: 27.8,
  outOfRangePs: 10.6,
};

/**
 * The resolve's G-buffer accesses per covered pixel of a surface that neither emits nor has an
 * occlusion map — sponza's 25 materials, the atrium —, each target's bytes (`surfaceBuffer.ts`):
 * develop read the flags, the base colour, the depth, the normal and the emission-and-occlusion
 * texel and wrote the colour; that texel is now read only under its flag bit (`surfaceEmission.ts`).
 * The normal keeps its three half floats, which no octahedral code gives back bit for bit; roughness
 * and metalness already ride in the alphas.
 */
export const RESOLVE_GBUFFER = {
  before: { flags: 1, baseMetal: 8, depth: 4, normalRough: 8, emissiveAo: 8, colour: 8 },
  after: { flags: 1, baseMetal: 8, depth: 4, normalRough: 8, colour: 8 },
};
/** Texels and bytes of a side of `RESOLVE_GBUFFER`. */
export const gbufferAccesses = (side: Record<string, number>) => ({
  texels: Object.keys(side).length,
  bytes: Object.values(side).reduce((a, b) => a + b, 0),
});

/** Milliseconds the rates give the grid pass, the resolve's light work and its G-buffer accesses
 *  of a `countGrid`, `side` the G-buffer's. */
export function lightingModel(
  { covered, listed, reach, work }: ReturnType<typeof countGrid>,
  side: keyof typeof RESOLVE_GBUFFER = 'after',
) {
  const r = LIGHTING_RATES;
  const tilePass =
    ((work.columnTests + 2 * work.solves) * r.pairNs * 1e3 +
      2 * (work.entries + work.cells) * r.texelPs) /
    1e9;
  const lightWork = (reach * r.inRangePs + (listed - reach) * r.outOfRangePs) / 1e9;
  const gbuffer = (covered * gbufferAccesses(RESOLVE_GBUFFER[side]).texels * r.texelPs) / 1e9;
  return { tilePass, lightWork, gbuffer, lighting: tilePass + lightWork + gbuffer };
}

/** Over the covered pixels of `view`: the lights their cells list, those reaching them, those
 *  missed; and the grid pass's work. */
export function countGrid(view: TileView, depths: Float32Array, lights: Light[]) {
  const sums = { covered: 0, listed: 0, reach: 0, missed: 0 };
  const work = walkGrid(view, depths, lights, (p, listed, within) => {
    sums.covered++;
    sums.listed += listed.length;
    for (const rank of within) {
      if (!reaches(p, lights[rank])) continue;
      sums.reach++;
      sums.missed += +!listed.includes(rank);
    }
  });
  return { ...sums, work };
}

async function main() {
  const { values } = parseArgs({
    options: {
      width: { type: 'string', default: '3456' },
      height: { type: 'string', default: '2234' },
      range: { type: 'string', default: '4' },
    },
  });
  const [width, height, range] = [values.width, values.height, values.range].map(Number);
  const lights = atriumLamps(200, range);
  const rows = ATRIUM_POSES.map(({ eye, yaw, pitch }, pose) => {
    const view = camera(eye, yaw, pitch, 60, width, height);
    const s = countGrid(view, atriumDepth(view), lights);
    const ms = Object.entries(lightingModel(s)).map(([k, v]) => [`${k} ms`, v.toFixed(3)]);
    ms.push(['develop gbuffer ms', lightingModel(s, 'before').gbuffer.toFixed(3)]);
    return {
      pose,
      covered: s.covered,
      listed: (s.listed / s.covered).toFixed(2),
      reach: (s.reach / s.covered).toFixed(2),
      missed: s.missed,
      ...s.work,
      ...Object.fromEntries(ms),
    };
  });
  console.log(`200 lamps of range ${range} m, ${width} × ${height}: lights per covered pixel`);
  console.table(rows);
  console.log("Develop's tile pass (#924) at the same size:", tilePassWork(width, height, 200));
  const [before, after] = [RESOLVE_GBUFFER.before, RESOLVE_GBUFFER.after].map(gbufferAccesses);
  console.log('G-buffer per covered pixel, develop then now:', before, after);
}

if (import.meta.main) await main();
