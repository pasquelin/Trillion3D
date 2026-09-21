import { CULL_STRIDE } from './gpuDagTypes.ts';
/**
 * The cut hierarchy as level-by-level descent reads it: its depth, and the one a
 * primitive without a hierarchy receives so descent is the only production path.
 *
 * Node layout, the manifest's: `[0..2]` min box, `[3..5]` max box, `[6..9]` sphere,
 * `[10]` replacement error ceiling, `[11]` first child, `[12]` child count, `[13]`
 * first page, `[14]` page count. Nodes are numbered by levels, root at rank zero:
 * descent therefore only has to start at that rank.
 *
 * The synthesised hierarchy changes no verdict: its error ceiling is -1, so none of
 * its nodes is ever rejected by error, and its box is the union of its pages' —
 * a page without a box makes the node box infinite, so the trunk rejects a node
 * only when every page carries a box it also rejects, one by one, as before.
 */
const LEAF_PAGES = 32,
  BRANCH = 8,
  STRIDE = CULL_STRIDE,
  INF = Infinity;

type Built = { min: number[]; max: number[]; first: number; pages: number; children: Built[] };

function box(
  pages: ReadonlyArray<{ min?: number[]; max?: number[] }>,
  from: number,
  count: number,
) {
  const min = [INF, INF, INF],
    max = [-INF, -INF, -INF];
  for (let i = from; i < from + count; i++) {
    const rec = pages[i];
    if (!rec.min || !rec.max) return { min: [-INF, -INF, -INF], max: [INF, INF, INF] };
    expand(min, max, rec.min, rec.max);
  }
  return { min, max };
}

/** Expands `[min, max]` to the box `[childMin, childMax]`, axis by axis. */
function expand(
  min: number[],
  max: number[],
  childMin: ArrayLike<number>,
  childMax: ArrayLike<number>,
) {
  for (let a = 0; a < 3; a++) {
    if (childMin[a] < min[a]) min[a] = childMin[a];
    if (childMax[a] > max[a]) max[a] = childMax[a];
  }
}

function merge(children: Built[]): Built {
  const min = [INF, INF, INF],
    max = [-INF, -INF, -INF];
  for (const child of children) expand(min, max, child.min, child.max);
  return { min, max, first: 0, pages: 0, children };
}

/** Numbering by levels, root at rank zero: a node's `firstChild` is therefore contiguous. */
function emit(root: Built, count: number) {
  const nodes = new Float64Array(count * STRIDE);
  const queue: Built[] = [root];
  let next = 1;
  for (let at = 0; at < queue.length; at++) {
    const node = queue[at],
      base = at * STRIDE;
    for (let a = 0; a < 3; a++) {
      nodes[base + a] = node.min[a];
      nodes[base + 3 + a] = node.max[a];
    }
    nodes[base + 10] = -1;
    nodes[base + 11] = node.children.length ? next : 0;
    nodes[base + 12] = node.children.length;
    nodes[base + 13] = node.first;
    nodes[base + 14] = node.pages;
    for (const child of node.children) queue.push(child);
    next += node.children.length;
  }
  return { nodes, stride: STRIDE };
}

/** Hierarchy a primitive without a hierarchy receives: thirty-two-page leaves, eight-child
 *  nodes, up to a single root. A primitive with no page keeps an empty leaf root. */
export function flatHierarchy(pages: ReadonlyArray<{ min?: number[]; max?: number[] }>) {
  let level: Built[] = [];
  for (let first = 0; first < pages.length; first += LEAF_PAGES) {
    const count = Math.min(LEAF_PAGES, pages.length - first);
    const { min, max } = box(pages, first, count);
    level.push({ min, max, first, pages: count, children: [] });
  }
  if (!level.length)
    level.push({ min: [0, 0, 0], max: [0, 0, 0], first: 0, pages: 0, children: [] });
  let total = level.length;
  while (level.length > 1) {
    const up: Built[] = [];
    for (let at = 0; at < level.length; at += BRANCH) up.push(merge(level.slice(at, at + BRANCH)));
    total += up.length;
    level = up;
  }
  return emit(level[0], total);
}

/**
 * Node count of each hierarchy level, root at level zero. Its length is the depth,
 * i.e. the number of passes descent needs to exhaust it.
 *
 * Level `L` UPPER-BOUNDS pass `L`'s queue: that queue only holds children of nodes
 * kept at level `L-1`, hence only nodes of level `L`, and descent writes them there
 * compacted from zero. That bound, known from packing once and for all, lets each
 * level pass launch FLAT: children past the queue leave on the count guard, the
 * dispatch argument's head word no longer has to be copied to an indirection buffer,
 * and nothing cuts descent — it fits in the head pass.
 *
 * THE MEASUREMENT THAT JUSTIFIES IT, published by `test/justesse/coupe-lancements-gpu.ts`
 * and cited from here only: on apple metal-3, one more level costs about 26 µs when it
 * opens its own pass behind two off-pass copies, and about 1.5 µs when it is a flat
 * dispatch in the head pass. The bench republishes the slope each run; those two
 * values are the order of magnitude. The bench does not split the copy from the pass
 * it cuts, and does not claim to: removing an arming would also change dispatch size,
 * hence the work done.
 *
 * The cost of those children that leave at once is bounded, and the bench sweeps it:
 * a level announced at 100,000 nodes costs as much as a level of 657, and it takes
 * announcing 1,000,000 to recover the previous level's price. The widest level is
 * about `clusterCount / CULLING_BRANCHING`, so the margin holds up to millions of
 * clusters per primitive.
 */
export function hierarchyLevelSizes(nodes: Float64Array, stride: number) {
  const count = nodes.length / stride;
  const sizes: number[] = [];
  if (count < 1) return sizes;
  let frontier = [0];
  while (frontier.length) {
    sizes.push(frontier.length);
    const next: number[] = [];
    for (const node of frontier) {
      const base = node * stride,
        children = nodes[base + 12];
      for (let c = 0; c < children; c++) next.push(nodes[base + 11] + c);
    }
    if (next.length > count) throw new Error('Inconsistent culling hierarchy');
    frontier = next;
  }
  return sizes;
}
