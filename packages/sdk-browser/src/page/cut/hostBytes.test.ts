// The main thread is bounded by the view (#483 rule 7, #486): the budget reads the cut's host
// tables on each eviction and each page arrival, so that read costs the same for a world and for
// the same world sixteen times larger, and the running totals it reads never drift from the
// placements they count. The work is counted, never timed: every typed array's `byteLength` read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleDag } from './cutRule.fixture.ts';
import { placements, stripCamera, webgl2Cut } from './cutRuleBackends.fixture.ts';
import { random } from './cutRuleChecks.fixture.ts';
import { selectVisiblePages } from './cut.ts';
import { createHeldBytes } from './held.ts';
import { packDagSelection } from '../../gpu/dag/pack.ts';
import { uploadResidency } from '../../gpu/dag/readiness.fixture.ts';
import type { ClusterRoot, PageRec } from '../selection/types.ts';

const dag = ruleDag(64),
  cam = stripCamera(dag);

const typedArray = Object.getPrototypeOf(Int32Array.prototype) as object,
  byteLength = Object.getOwnPropertyDescriptor(typedArray, 'byteLength')!;

/** `copies` placements of the DAG, every page resident. */
function loaded(copies: number) {
  const roots = placements(dag, copies);
  for (const root of roots) for (const page of root.pages) page.array = new Uint32Array(3);
  return roots;
}

/** How many typed arrays `read` weighs. */
function weighed(read: () => number) {
  let count = 0;
  Object.defineProperty(typedArray, 'byteLength', {
    ...byteLength,
    get(this: ArrayBufferView) {
      count++;
      return byteLength.get!.call(this);
    },
  });
  try {
    assert.ok(read() > 0, 'the view holds something');
  } finally {
    Object.defineProperty(typedArray, 'byteLength', byteLength);
  }
  return count;
}

test('reading the host bytes weighs as many tables for 2 placements as for 32', () => {
  const reads = (copies: number) => {
    // All in view: every placement is cut, and held.
    const roots = loaded(copies);
    // WebGL2: the image's cut, its closure and each placement's readiness.
    const cut = webgl2Cut(roots);
    cut(cam, 0.1);
    // WebGPU: the GPU kernel's readiness and its upload's change lists.
    const packed = packDagSelection(roots),
      gpu = uploadResidency(packed, new Uint8Array(packed.pageCount).fill(1));
    return { webgl2: weighed(() => cut.hostBytes()), gpu: weighed(() => gpu.hostBytes) };
  };
  assert.deepEqual(reads(32), reads(2));
});

test("the CPU cut's readiness total follows every settle, a replaced state and new placements", () => {
  const roots = placements(dag, 4),
    total = createHeldBytes(),
    next = random(7);
  const cutAll = (list: readonly ClusterRoot<PageRec>[]) =>
    selectVisiblePages(list, cam, { pixelError: 0.1, viewport: [1280, 720], holdResident: true });
  const load = (list: readonly ClusterRoot<PageRec>[], share: number) => {
    for (const root of list)
      for (const page of root.pages) page.array = next() < share ? new Uint32Array(3) : undefined;
  };
  /** The running total, then the same placements counted again by walking them. */
  const recounted = (list: readonly ClusterRoot<PageRec>[]) => {
    const running = total.bytes;
    total.track(list);
    return [running, total.bytes] as const;
  };
  total.track(roots);
  let peak = 0;
  for (let frame = 0; frame < 24; frame++) {
    load(roots, frame % 6 === 5 ? 0 : next());
    cutAll(roots);
    peak = Math.max(peak, total.bytes);
    const [running, walked] = recounted(roots);
    assert.equal(running, walked, `frame ${frame}`);
  }
  assert.ok(peak > 0, 'the pool held pages');
  // A placement whose hierarchy changed starts over: its old state leaves the total.
  load(roots, 1);
  cutAll(roots);
  (roots[1] as { structure: object }).structure = { ...dag.structure };
  cutAll(roots);
  assert.equal(...recounted(roots));
  // Placements that left are no longer counted, even when another cut still settles them.
  const kept = roots.slice(0, 2);
  total.track(kept);
  load(roots, 0.5);
  cutAll(roots);
  assert.equal(...recounted(kept));
});

test('the WebGL2 image counts the placements added and removed since its last cut', () => {
  const fresh = (copies: number) => {
    const cut = webgl2Cut(loaded(copies));
    cut(cam, 0.1);
    return cut.hostBytes();
  };
  const roots = loaded(2),
    cut = webgl2Cut(roots);
  cut(cam, 0.1);
  roots.push(loaded(3)[2]);
  cut(cam, 0.1);
  assert.equal(cut.hostBytes(), fresh(3), 'an added placement');
  roots.pop();
  cut(cam, 0.1);
  assert.equal(cut.hostBytes(), fresh(2), 'a removed placement');
});
