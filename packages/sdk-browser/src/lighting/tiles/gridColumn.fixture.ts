// One column of the light grid's pass, two ways: the shipped routines of `compactWgsl.ts` run lane
// by lane in the order `lightTiles` (`./shader.ts`) runs them between its barriers, and a serial
// model — each slice's list the lights whose run holds it, in increasing order, its room taken
// after the others'. Between two barriers the lanes meet only through atomic ORs and their own
// words, so running them one after the other is one of the orders the GPU may take.
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { builtins } from '../../texture/shaderRunBuiltins.fixture.ts';
import { wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { directLightWgsl } from '../direct/lightWgsl.ts';
import { GRID_COMPACT_WGSL } from './compactWgsl.ts';

const W = { ...wgslConstants(directLightWgsl()), ...wgslConstants(GRID_COMPACT_WGSL) };
export const { GRID_SLICES, TILE_SHADOWED, TILE_NO_SLICE, LANES, CACHE } = W;
const { EMPTY_RUN, ALL_CACHED } = W;
/** A light's run in the column, `[first, last]`, and whether it holds a shadow slot; `null` when
 *  it meets no cell of the column. */
export type Run = { first: number; last: number; slot: boolean } | null;
export type Pool = { start: number; capacity: number; head: number; overflow: number };
/** A column's cell records and the pool words it wrote; the pass's, the slice marks it set. */
export type Column = {
  counts: number[];
  cursor: number[];
  words: Map<number, number>;
  marks?: number;
};

/** `count` lights holding every slice, as suns do, every third one with a shadow slot. */
export const suns = (count: number): Run[] =>
  Array.from({ length: count }, (_, i) => ({ first: 0, last: GRID_SLICES - 1, slot: i % 3 === 0 }));

/** What `entryOf` answers for light `index` of run `run`. */
const entryOf = (index: number, run: Run) =>
  run
    ? [(index | (run.slot ? TILE_SHADOWED : 0)) >>> 0, run.first | (run.last << 16)]
    : [index, EMPTY_RUN];

/** WGSL's `u32` arithmetic: sums, differences and products wrap, a division truncates. */
const u32 = (op: string, a: unknown, b: unknown) => {
  if (typeof a !== 'number' || typeof b !== 'number')
    return builtins.$b(op, a as never, b as never);
  if (op === '/') return Math.trunc(a / b);
  if (op === '*') return Math.imul(a, b) >>> 0;
  if (op === '+' || op === '-') return (op === '+' ? a + b : a - b) >>> 0;
  return builtins.$b(op, a, b);
};
/** The pass's workgroup scalars, read through one object the harness sees too. */
const SCALARS = /\b(cached|resume|walked)\b/g;
const NAMES = ['markEntry', 'countSlices', 'writeSlices', 'cacheEntry', 'laneRun'];
const ROOM = ['roomBefore', 'takeRoom', 'dealRoom'];

/** The shipped routines over one workgroup's memory and the pool. */
function workgroup(pool: Pool, words: Map<number, number>) {
  const ws = { cached: 0, resume: ALL_CACHED, walked: [0, 0, 0, 0], marks: 0 };
  // A slice's mask set to anything but zero: one lane's bit marked there.
  const marked = (masks: number[], at: string | symbol, value: number) => (
    value && ws.marks++,
    (masks[at as never] = value as never),
    true
  );
  const laneSums: number[] = [];
  const memory = {
    chunk: Array.from({ length: LANES }, () => [0, EMPTY_RUN]),
    masks: new Proxy(new Array<number>(2 * GRID_SLICES).fill(0), { set: marked }),
    full: [0, 0],
    slotted: [0, 0],
    keptLanes: [0, 0],
    counts: new Array<number>(GRID_SLICES).fill(0),
    cursor: new Array<number>(GRID_SLICES).fill(0),
    cache: [] as number[][],
  };
  const tiles = new Proxy([], { set: (_, at, value) => (words.set(Number(at), value), true) });
  const source = GRID_COMPACT_WGSL.replace(SCALARS, 'ws.$1');
  const fns = shaderRun<Record<string, (...args: never[]) => never>>(source, [...NAMES, ...ROOM], {
    ...W,
    ...memory,
    ws,
    pool,
    tiles,
    laneSums,
    $b: u32,
    // The engine's lane scan (`../../gpu/core/laneScanWgsl.ts`), lanes called in order: each
    // lane's inclusive prefix, `laneSums[63]` the total.
    laneScan: (lane: number, value: number) =>
      (laneSums[lane] = ((laneSums[lane - 1] ?? 0) + value) >>> 0),
  });
  return { ws, memory, fns };
}

/** Between the walks, as `lightTiles` runs it: the lanes scan their runs, lane zero takes the room
 *  and leaves the walk's words, each lane deals the room out over its run. */
function dealRoom({ ws, fns }: ReturnType<typeof workgroup>, count: number) {
  const lanes = [...Array(LANES).keys()],
    spans = lanes.map((lane) => fns.laneRun(lane as never, GRID_SLICES as never));
  const before = lanes.map((lane) => fns.roomBefore(lane as never, spans[lane]));
  fns.takeRoom();
  ws.walked[1] = ws.cached;
  ws.walked[2] = ws.resume === ALL_CACHED ? count : ws.resume;
  for (const lane of lanes) fns.dealRoom(spans[lane], before[lane], ws.walked[3] as never);
}

/** A column of slice counts `counts` taking its room in `pool`: its cursors, and whether its
 *  second walk writes. */
export function columnRoom(counts: number[], pool: Pool) {
  const group = workgroup(pool, new Map());
  group.memory.counts.splice(0, GRID_SLICES, ...counts);
  dealRoom(group, 0);
  return { cursor: group.memory.cursor, room: group.ws.walked[0] };
}

/** The column of lights `runs`, its room taken in `pool`, as the pass runs it. */
export function shippedColumn(runs: Run[], pool: Pool): Column {
  const words = new Map<number, number>();
  const group = workgroup(pool, words),
    { ws, memory, fns } = group;
  const each = (run: (lane: number) => void) => {
    for (let lane = 0; lane < LANES; lane++) run(lane);
  };
  /** One batch: `entry(lane)` marked, then `then` on every lane. */
  const batch = (entry: (lane: number) => number[], then: string) => {
    each((lane) => fns.markEntry(lane as never, entry(lane) as never));
    each((lane) => fns[then](lane as never));
  };
  const count = runs.length,
    ofLight = (i: number) => (i < count ? entryOf(i, runs[i]) : [i, EMPTY_RUN]);
  for (let first = 0; first < count; first += LANES) {
    const entries = Array.from({ length: LANES }, (_, lane) => ofLight(first + lane));
    batch((lane) => entries[lane], 'countSlices');
    const kept =
      (builtins.countOneBits(memory.keptLanes[0]) as number) +
      (builtins.countOneBits(memory.keptLanes[1]) as number);
    const fits = ws.resume === ALL_CACHED && ws.cached + kept <= CACHE;
    if (fits) each((lane) => fns.cacheEntry(lane as never, entries[lane] as never));
    if (fits) ws.cached += kept;
    else if (ws.resume === ALL_CACHED) ws.resume = first;
    memory.keptLanes.fill(0);
    memory.slotted.fill(0);
  }
  dealRoom(group, count);
  const records: Column = { counts: [...memory.counts], cursor: [...memory.cursor], words };
  const [room, held, resume] = ws.walked;
  if (room !== 0) {
    for (let at = 0; at < held; at += LANES)
      batch((lane) => (at + lane < held ? memory.cache[at + lane] : [0, EMPTY_RUN]), 'writeSlices');
    for (let first = resume; first < count; first += LANES)
      batch((lane) => ofLight(first + lane), 'writeSlices');
  }
  return { ...records, marks: ws.marks };
}

/** The same column, serially: each slice's lights in increasing order, its room after the last. */
export function serialColumn(runs: Run[], pool: Pool): Column {
  const lists = Array.from({ length: GRID_SLICES }, (_, slice) =>
    runs.flatMap((run, i) => (run && run.first <= slice && slice <= run.last ? [i] : [])),
  );
  const counts = lists.map(
    (list) => (list.length | (list.some((i) => runs[i]!.slot) ? TILE_SHADOWED : 0)) >>> 0,
  );
  const total = lists.reduce((sum, list) => sum + list.length, 0);
  let at = 0,
    fits = true;
  if (total > 0) {
    at = pool.head < 0x80000000 ? pool.head : 0xffffffff;
    if (pool.head < 0x80000000) pool.head = (pool.head + total) >>> 0;
    fits = at < pool.capacity && total <= pool.capacity - at;
    if (!fits) pool.overflow = 1;
  }
  const words = new Map<number, number>();
  let next = pool.start + at;
  const cursor = lists.map((list) => {
    const start = fits ? next >>> 0 : TILE_NO_SLICE;
    if (fits) list.forEach((light, k) => words.set(start + k, light));
    next += list.length;
    return start;
  });
  return { counts, cursor, words };
}
