import { shaderFunctions, wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { clusterSliceIndexWgsl, CLUSTER_SLICES } from './clusterWgsl.ts';
import { LIGHT_TILES_SHADER } from './shader.ts';

/** The shipped slice mapping, run as JavaScript (#1249): the slice of an axis distance and the span
 *  of a light on it, so the tests and the witness run what the WGSL does, not a second copy. */
export type SliceMap = {
  clusterSliceIndex: (d: number, front: number, back: number) => number;
  clusterSliceSpan: (d: number, r: number, front: number, back: number) => { x: number; y: number };
};
const MATH = { log: Math.log, floor: Math.floor, abs: Math.abs };
export const sliceMap = (): SliceMap =>
  shaderFunctions<SliceMap>(clusterSliceIndexWgsl, ['clusterSliceIndex', 'clusterSliceSpan'], {
    ...wgslConstants(clusterSliceIndexWgsl),
    CLUSTER_SLICES,
    ...MATH,
  });

/** A light on the view axis: its centre's axis distance from the eye, its range, its kind. */
export type AxisLight = { positionRange: { xyz: number; w: number }; params: { x: number } };
const PASS = wgslConstants(LIGHT_TILES_SHADER);
const LANES = 256;

/**
 * The tile pass's light grid, the shipped functions run lane by lane as the pass runs them
 * (`clusterMasks`): every lane settles its bits (`clusterPartBits`) over the walked slice — the
 * list, its pool room, or every light —, then the first `2 · CLUSTER_SLICES` lanes gather them
 * into the record's mask words (`clusterWord`). The world is the view axis alone, the eye at its
 * origin: the pass reads a light's centre only through its axis distance. `front` and `back` are
 * the tile's nearest and farthest surfaces, in metres, as `clusterFrame` derives them.
 */
export function passMasks(
  tiles: Uint32Array,
  base: number,
  lights: AxisLight[],
  front: number,
  back: number,
) {
  const kept = tiles[base];
  const walked =
    kept > PASS.TILE_LIGHTS && tiles[base + PASS.TILE_OPAQUE_BASE] === PASS.TILE_NO_SLICE
      ? lights.length
      : kept;
  const clusterBits = new Uint32Array(LANES);
  const { clusterPartBits, clusterWord } = shaderFunctions<{
    clusterPartBits: (base: number, kept: number, walked: number, lane: number) => number;
    clusterWord: (word: number) => number;
  }>(
    LIGHT_TILES_SHADER,
    [
      'clusterPartBits',
      'clusterWord',
      'clusterListed',
      'clusterReaches',
      'clusterSliceSpan',
      'clusterSliceIndex',
      'clusterGroup',
      'isSun',
    ],
    {
      ...PASS,
      ...MATH,
      tiles,
      clusterBits,
      lights: { items: lights },
      view: { origin: { xyz: 0 } },
      clusterAxis: 1,
      clusterFront: front,
      clusterBack: back,
      dot: (a: number, b: number) => a * b,
    },
  );
  for (let lane = 0; lane < LANES; lane++) clusterBits[lane] = clusterPartBits(base, kept, walked, lane);
  for (let word = 0; word < 2 * CLUSTER_SLICES; word++)
    tiles[base + PASS.TILE_CLUSTER_BASE + word] = clusterWord(word);
}
