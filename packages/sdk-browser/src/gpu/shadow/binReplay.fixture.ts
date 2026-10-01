// The shipped raster-bin kernel (`binShader.ts`, OMB-25/OMB-26, #966) run under node: its functions
// as JavaScript, a workgroup's lanes taken in a given order at each barrier.
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { SHADOW_REGION_COMMANDS } from './batchBudget.ts';
import { SHADOW_BIN_CLASSES, shadowBinShader } from './binShader.ts';

/** A region's bin commands, as the kernel counts them, and a class's corners: 32 triangles. */
export const SHADOW_BIN_COMMANDS = SHADOW_REGION_COMMANDS * SHADOW_BIN_CLASSES,
  SHADOW_BIN_CORNERS = 32 * 3;

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

const NAMES = [
  'keptCount',
  'keptAt',
  'binOf',
  'binIndex',
  'binCommand',
  'binMasked',
  'binLists',
  'binRow',
  'binClear',
  'binCount',
  'binCommands',
  'binScatter',
];

/** The kernel over `buffers` (`shaderRun`), its workgroup arrays zeroed, the matrix product the
 *  test's by name. */
export function binKernel(stored: boolean, buffers: BinBuffers): Kernel {
  const source = shadowBinShader(stored);
  if (stored !== source.includes(PRODUCT))
    throw new Error('the stored product is not the kernel’s');
  const bins = () => new Array<number>(SHADOW_BIN_COMMANDS).fill(0);
  const workgroup = { binTotal: bins(), binCorners: bins(), binNext: bins(), binFirst: bins() };
  const names = stored ? [...NAMES, 'localToClip', 'storeLocalToClip'] : NAMES;
  return shaderRun<Kernel>(
    source.replace(PRODUCT, 'mul(views[region].viewProjection,pages[row].world)'),
    names,
    { ...buffers, ...workgroup },
  );
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
