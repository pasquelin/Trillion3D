/**
 * Least-cost paths over a coarse height grid (#332): how rivers find their way to the sea and
 * roads their way across the land. A* over sixteen directions, so a path can climb a slope at
 * a shallow angle instead of only along the eight grid directions.
 */
import { WORLD } from './contract.ts';

/** Grid step, metres: a tenth of a tile, fine enough for a street block, coarse enough to route fast. */
export const STEP = WORLD.tile / 10;
const SIDE = WORLD.size / STEP + 1;
const HALF = WORLD.size / 2;
const MOVES = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
  [2, 1],
  [1, 2],
  [-1, 2],
  [-2, 1],
  [-2, -1],
  [-1, -2],
  [1, -2],
  [2, -1],
] as const;

export type HeightGrid = { heights: Float64Array; at(x: number, z: number): number };

/** Samples a height function at every grid node. */
export function heightGrid(height: (x: number, z: number) => number): HeightGrid {
  const heights = new Float64Array(SIDE * SIDE);
  for (let j = 0; j < SIDE; j++)
    for (let i = 0; i < SIDE; i++) heights[j * SIDE + i] = height(i * STEP - HALF, j * STEP - HALF);
  return { heights, at: (x, z) => heights[node(x, z)] };
}

export const node = (x: number, z: number) =>
  Math.round((Math.min(HALF, Math.max(-HALF, z)) + HALF) / STEP) * SIDE +
  Math.round((Math.min(HALF, Math.max(-HALF, x)) + HALF) / STEP);
export const nodeX = (index: number) => (index % SIDE) * STEP - HALF;
export const nodeZ = (index: number) => Math.floor(index / SIDE) * STEP - HALF;

/**
 * The cost of one move: `length` metres climbing `rise` metres from node `from` to node `to`;
 * `Infinity` forbids it. Must be at least `length`, so the straight distance stays a lower bound.
 */
export type MoveCost = (from: number, to: number, length: number, rise: number) => number;

/** The cheapest path between two points as world positions, or `null` when none exists. */
export function route(
  grid: HeightGrid,
  start: readonly [number, number],
  goal: readonly [number, number] | ((index: number) => boolean),
  cost: MoveCost,
): [number, number][] | null {
  const from = node(start[0], start[1]),
    target = typeof goal === 'function' ? -1 : node(goal[0], goal[1]),
    done = typeof goal === 'function' ? goal : (index: number) => index === target,
    heuristic = (index: number) =>
      target < 0 ? 0 : Math.hypot(nodeX(index) - nodeX(target), nodeZ(index) - nodeZ(target)),
    best = new Float64Array(SIDE * SIDE).fill(Infinity),
    parent = new Int32Array(SIDE * SIDE).fill(-1),
    heap: [number, number][] = [];
  const push = (priority: number, index: number) => {
    heap.push([priority, index]);
    for (let at = heap.length - 1; at > 0;) {
      const up = (at - 1) >> 1;
      if (heap[up][0] <= heap[at][0]) break;
      [heap[up], heap[at]] = [heap[at], heap[up]];
      at = up;
    }
  };
  const pop = () => {
    const top = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let at = 0; ;) {
        const left = at * 2 + 1,
          right = left + 1;
        let low = at;
        if (left < heap.length && heap[left][0] < heap[low][0]) low = left;
        if (right < heap.length && heap[right][0] < heap[low][0]) low = right;
        if (low === at) break;
        [heap[low], heap[at]] = [heap[at], heap[low]];
        at = low;
      }
    }
    return top;
  };
  best[from] = 0;
  push(heuristic(from), from);
  while (heap.length) {
    const [priority, index] = pop();
    if (priority > best[index] + heuristic(index) + 1e-6) continue;
    if (done(index)) {
      const path: [number, number][] = [];
      for (let at = index; at >= 0; at = parent[at]) path.push([nodeX(at), nodeZ(at)]);
      return path.reverse();
    }
    const i = index % SIDE,
      j = (index - i) / SIDE;
    for (const [di, dj] of MOVES) {
      const ni = i + di,
        nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= SIDE || nj >= SIDE) continue;
      const next = nj * SIDE + ni,
        step = cost(
          index,
          next,
          Math.hypot(di, dj) * STEP,
          grid.heights[next] - grid.heights[index],
        ),
        total = best[index] + step;
      if (total < best[next]) {
        best[next] = total;
        parent[next] = index;
        push(total + heuristic(next), next);
      }
    }
  }
  return null;
}
