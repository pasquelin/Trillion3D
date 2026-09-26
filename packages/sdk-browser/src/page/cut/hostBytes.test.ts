// The main thread is bounded by the view (#483 rule 7, #486): the budget reads the cut's host
// tables on each eviction and each page arrival, so that read costs the same for a world and for
// the same world sixteen times larger, and the running totals it reads never drift from the
// placements they count. The work is counted, never timed: every typed array's `byteLength` read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleDag } from './cutRule.fixture.ts';
import { AWAY, placements, stripCamera } from './cutRuleBackends.fixture.ts';
import { webgl2Cut } from './cutRuleHosts.fixture.ts';
import { random } from './cutRuleChecks.fixture.ts';
import { selectVisiblePages } from './cut.ts';
import { createHeldResidency } from './held.ts';
import { packDagSelection } from '../../gpu/dag/pack.ts';
import { uploadResidency } from '../../gpu/dag/readiness.fixture.ts';

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

test("the CPU cut's readiness total drops to zero after any moves, replaced states and exits", () => {
  const roots = placements(dag, 4),
    held = createHeldResidency(),
    next = random(7);
  const cutAll = () =>
    selectVisiblePages(roots, cam, {
      pixelError: 0.1,
      viewport: [1280, 720],
      holdResident: true,
      held,
    });
  held.track(roots);
  let peak = 0;
  for (let frame = 0; frame < 24; frame++) {
    const share = frame % 6 === 5 ? 0 : next();
    for (const root of roots) {
      // A placement comes and goes; its pages move, and the feed names each.
      root.worldBox = next() < 0.3 ? AWAY : undefined;
      for (const page of root.pages)
        if (!!page.array !== next() < share) {
          page.array = page.array ? undefined : new Uint32Array(3);
          held.moved(page);
        }
    }
    // A placement whose hierarchy changed starts over: its old state leaves the total.
    if (frame === 12) (roots[1] as { structure: object }).structure = { ...dag.structure };
    cutAll();
    peak = Math.max(peak, held.bytes);
  }
  assert.ok(peak > 0, 'the pool held pages');
  for (const root of roots) root.worldBox = AWAY;
  cutAll();
  assert.deepEqual([held.placements, held.bytes], [0, 0]);
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
