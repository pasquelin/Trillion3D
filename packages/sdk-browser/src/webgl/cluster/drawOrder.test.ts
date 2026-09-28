import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawOrder, type OrderedNode } from './drawOrder.ts';
import { depthOf } from './meshDepth.ts';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import { IDENTITY_ELEMENTS } from '../../math/matrixElements.ts';

/** The screen the depths are read through: the identity, so a node's depth is its centre's z
 *  over its matrix's w (`node` below). */
const SCREEN = IDENTITY_ELEMENTS;
const EDGES = [NaN, 0, -0, Infinity, -Infinity, 1e308, -1e308, 5e-324];

/** A test's node: its own bounding sphere, which its depth reads first, and maybe a number. */
type Node = OrderedNode & {
  readonly boundingSphere: { readonly center: { x: number; y: number; z: number } };
  readonly serial?: number;
};

/** A test node's creation number: its own, the engine's side table holding none of these. */
const serialOfNode = (n: OrderedNode) => (n as Node).serial;

/** A node whose depth is `z / w` (`w` = ±1 gives ±0 from a zero `z`). */
function node(z: number, w: number, renderOrder: number, material: object, serial?: number): Node {
  const elements = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, w]);
  const sphere = { center: { x: 0, y: 0, z }, radius: 1 };
  return { boundingSphere: sphere, matrixWorld: { elements }, renderOrder, material, serial };
}

/**
 * The order as the draw computed it before its keys were flattened, frozen: a depth map, the
 * surfaces numbered inside the opaque comparator, every key read from the node at each comparison.
 */
function frozenOrder() {
  const ranks = new WeakMap<object, number>();
  let nextRank = 0;
  const rankOf = (mesh: Node) => {
    const surface = mesh.material as object;
    let rank = ranks.get(surface);
    if (rank === undefined) ranks.set(surface, (rank = nextRank++));
    return rank;
  };
  const depths = new Map<Node, number>();
  const depth = (n: Node) => depths.get(n)!;
  const made = (n: Node) => serialOfNode(n) ?? 0;
  const frontToBack = (a: Node, b: Node) =>
    a.renderOrder - b.renderOrder ||
    rankOf(a) - rankOf(b) ||
    depth(a) - depth(b) ||
    made(a) - made(b);
  const backToFront = (a: Node, b: Node) =>
    a.renderOrder - b.renderOrder || depth(b) - depth(a) || made(a) - made(b);
  return (opaque: Node[], seeThrough: Node[], screen: ArrayLike<number>) => {
    depths.clear();
    for (const n of opaque) depths.set(n, depthOf(n, screen));
    for (const n of seeThrough) depths.set(n, depthOf(n, screen));
    opaque.sort(frontToBack);
    seeThrough.sort(backToFront);
  };
}

/** One frame's lists: few distinct keys so ties are common, the edge values mixed in when asked. */
function frame(next: () => number, count: number, surfaces: object[], edges: boolean) {
  const pick = <T>(values: readonly T[]) => values[Math.floor(next() * values.length)];
  const value = (spread: number) =>
    edges && next() < 0.3 ? pick(EDGES) : Math.floor(next() * spread) - spread / 2;
  const make = () =>
    node(
      value(8),
      next() < 0.5 ? 1 : -1,
      edges && next() < 0.1 ? pick(EDGES) : Math.floor(next() * 3),
      pick(surfaces),
      next() < 0.2 ? undefined : Math.floor(next() * count),
    );
  return [Array.from({ length: count }, make), Array.from({ length: Math.floor(count / 3) }, make)];
}

/** The first place two orders of the same nodes differ, or -1. */
const firstDifference = (actual: readonly Node[], expected: readonly Node[]) =>
  actual.length === expected.length ? actual.findIndex((n, i) => n !== expected[i]) : 0;

/** Sorts the same frames with both orders, the surfaces growing between frames, and compares. */
function compare(seed: number, sizes: readonly number[], edges: boolean) {
  const next = random(seed),
    flat = createDrawOrder(serialOfNode),
    frozen = frozenOrder(),
    surfaces: object[] = [];
  for (const size of sizes) {
    for (let i = 0; i < 1 + Math.floor(next() * 4); i++) surfaces.push({});
    const [opaque, seeThrough] = frame(next, size, surfaces, edges);
    const [expectedOpaque, expectedSeeThrough] = [opaque.slice(), seeThrough.slice()];
    frozen(expectedOpaque, expectedSeeThrough, SCREEN);
    flat(opaque, seeThrough, SCREEN);
    assert.equal(firstDifference(opaque, expectedOpaque), -1, `opaque, seed ${seed}`);
    assert.equal(firstDifference(seeThrough, expectedSeeThrough), -1, `see-through, seed ${seed}`);
  }
}

// #920 (audit CPU-10): the flat keys sort the draws exactly as the node comparators did.
test('the flat keys give the same order as the node comparators on random frames', () => {
  for (let seed = 1; seed <= 40; seed++) compare(seed, [0, 1, 2, 7, 33, 150, 40, 600], false);
});

test('the flat keys give the same order with NaN, ±0, ±Inf and extreme depths and orders', () => {
  for (let seed = 100; seed <= 140; seed++) compare(seed, [3, 17, 64, 300, 64], true);
});

test('the flat keys give the same order on a large list, then on a shorter one', () => {
  compare(7, [20_000, 5, 12_000], true);
});

test('a -0 depth sorts as the node comparators sort it', () => {
  const surface = {},
    zero = node(0, 1, 0, surface, 2),
    negativeZero = node(0, -1, 0, surface, 1);
  assert.ok(Object.is(depthOf(negativeZero, SCREEN), -0), 'the fixture reads -0');
  const lists = [zero, negativeZero],
    expected = lists.slice();
  frozenOrder()(expected, [], SCREEN);
  createDrawOrder(serialOfNode)(lists, [], SCREEN);
  assert.deepEqual(lists, expected);
  assert.deepEqual(lists, [negativeZero, zero], 'equal depths: the creation number decides');
});
