// The shipped raster-bin kernel (`binShader.ts`, OMB-25/OMB-26, #966) run under node: its functions
// as JavaScript, a workgroup's lanes taken in a given order at each barrier.
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts';
import { SHADOW_BIN_COMMANDS, shadowBinShader } from './binShader.ts';

const bits = new Float32Array(1),
  word = new Uint32Array(bits.buffer);
/** WGSL's `bitcast<u32>(f32)` and `bitcast<f32>(u32)`. */
export const asU32 = (value: number) => ((bits[0] = value), word[0]);
export const asF32 = (value: number) => ((word[0] = value), bits[0]);

/** The product the stored LocalToClip is, as the kernel spells it (`localToClip`). */
const PRODUCT = 'views[region].viewProjection*pages[row].world';

/** What one dispatch reads and writes, as the kernel's bindings name them. */
export type BinBuffers = {
  uni: { regions: number; capacity: number; maskLow: number; maskHigh: number };
  list: number[];
  counts: number[];
  mobility: number[];
  binned: number[];
  commands: number[];
  pages?: unknown[];
  views?: unknown[];
  mul?: (a: never, b: never) => unknown;
};

type Lists = { x: number; y: number };
type Kernel = {
  binOf: (word: number) => number;
  binMasked: (region: number) => boolean;
  binLists: (region: number) => Lists;
  binClear: (lane: number) => void;
  binCount: (region: number, lane: number, lists: Lists) => void;
  binCommands: (region: number) => void;
  binScatter: (region: number, lane: number, lists: Lists) => void;
  keptAt: (region: number, rank: number, capacity: number, cutout: boolean) => number;
  localToClip: (region: number, row: number) => unknown;
  storeLocalToClip: (place: number, m: unknown) => void;
};

const NAMES = ['keptCount', 'keptAt', 'binOf', 'binIndex', 'binCommand', 'binMasked', 'binLists'];
NAMES.push('binRow', 'binClear', 'binCount', 'binCommands', 'binScatter');

/** The kernel over `buffers`: its void functions given a type, its atomics on a workgroup array
 *  respelled as calls on it, the matrix product and the bit casts by name. */
export function binKernel(stored: boolean, buffers: BinBuffers): Kernel {
  let source = shadowBinShader(stored)
    .replace(/fn (\w+)\(([^)]*)\)\{/g, 'fn $1($2)->void{')
    .replace(/atomic(\w+)\(&(\w+)\[([^\]]+)\]/g, 'atomic$1($2,$3')
    .replace(/bitcast<u32>\(/g, 'asU32(');
  if (stored !== source.includes(PRODUCT))
    throw new Error('the stored product is not the kernel’s');
  source = source.replace(PRODUCT, 'mul(views[region].viewProjection,pages[row].world)');
  const bins = () => new Array<number>(SHADOW_BIN_COMMANDS).fill(0);
  const workgroup = { binTotal: bins(), binCorners: bins(), binNext: bins(), binFirst: bins() };
  const atomics = {
    atomicAdd: (at: number[], i: number, value: number) => ((at[i] += value), at[i] - value),
    atomicMax: (at: number[], i: number, value: number) => ((at[i] = Math.max(at[i], value)), 0),
    atomicLoad: (at: number[], i: number) => at[i],
    atomicStore: (at: number[], i: number, value: number) => void (at[i] = value),
  };
  const names = stored ? [...NAMES, 'localToClip', 'storeLocalToClip'] : NAMES;
  return shaderFunctions<Kernel>(source, names, { ...buffers, ...workgroup, ...atomics, asU32 });
}

/** One dispatch of `regions` workgroups: each runs its lanes in `order()`'s turn at each barrier —
 *  the GPU's order is free, so a test shuffles it. */
export function runBins(kernel: Kernel, regions: number, order: () => number[]) {
  for (let region = 0; region < regions; region++) {
    if (!kernel.binMasked(region)) continue;
    const lists = kernel.binLists(region);
    for (const lane of order()) kernel.binClear(lane);
    for (const lane of order()) kernel.binCount(region, lane, lists);
    kernel.binCommands(region);
    for (const lane of order()) kernel.binScatter(region, lane, lists);
  }
}
