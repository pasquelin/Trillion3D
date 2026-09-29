// CPU-12 (#919): an image hands the frame gate no new closure. The list of nodes the host may write
// is read through `rt.watchedSources`, built once with the runtime; the audit measured 56 bytes per
// image for the closure `renderWebgpuPages` used to build at each call. Its `renderClosure_bytesPerCall`
// harness is ported below on the real runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import { type WebgpuPagesRuntime } from '../runtime.ts';
import { disposeWebgpuPages } from '../io/metrics.ts';
import { renderWebgpuPages } from './render.ts';
import { flushWebgpuPages } from './flush.ts';
import { camera } from '../testScenes.fixture.ts';
import { drawnQuad } from '../drawnQuad.fixture.ts';

async function withRuntime(body: (rt: WebgpuPagesRuntime) => Promise<void> | void) {
  const { rt } = await drawnQuad(false);
  try {
    await body(rt);
  } finally {
    disposeWebgpuPages(rt);
  }
}

/** The closure the audit found built per image: the drawn roots' first page, then the blend nodes. */
const perImage = (rt: WebgpuPagesRuntime) => () => [
  ...rt.layout.selectionRoots.map((root) => root.pages[0]),
  ...rt.blendState.blendGpu,
];

test('every image hands the frame gate the runtime watched-sources closure, never a new one', async () => {
  await withRuntime(async (rt) => {
    const handed: unknown[] = [];
    const enterFrame = rt.run.gate.enterFrame.bind(rt.run.gate);
    rt.run.gate.enterFrame = (...args: Parameters<typeof enterFrame>) => {
      handed.push(args[5]);
      return enterFrame(...args);
    };
    for (let image = 0; image < 3; image++) {
      renderWebgpuPages(rt, camera());
      await flushWebgpuPages(rt);
    }
    assert.equal(handed.length, 3);
    for (const drawn of handed) assert.equal(drawn, rt.watchedSources, 'the one closure');
    const listed = rt.watchedSources();
    assert.ok(listed.length > 0, 'the drawn roots are listed');
    assert.deepStrictEqual(listed, perImage(rt)(), 'the nodes the per-image closure listed');
  });
});

/** Bytes allocated per call of `fn`: the median heap growth of 9 runs of 10,000 calls (the audit's
 *  `allocPerCall`, without a forced collection; the median drops a run a scavenge crossed). */
function bytesPerCall(fn: () => void, calls = 10_000) {
  for (let i = 0; i < 1000; i++) fn();
  const runs: number[] = [];
  for (let run = 0; run < 9; run++) {
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < calls; i++) fn();
    runs.push((process.memoryUsage().heapUsed - before) / calls);
  }
  return runs.sort((a, b) => a - b)[4];
}

test('renderClosure_bytesPerCall: the watched-sources hand-over allocates nothing per image', async () => {
  await withRuntime((rt) => {
    // The gate keeps what it is handed, as `readScene` does: the closure escapes and is allocated.
    let kept: unknown;
    const enter = (drawn: () => unknown[]) => void (kept = drawn);
    const perCall = bytesPerCall(() => enter(() => rt.watchedSources()));
    const hoisted = bytesPerCall(() => enter(rt.watchedSources));
    assert.ok(kept, 'the hand-over reached the gate');
    assert.ok(perCall >= 16, `a closure per image costs ${perCall} bytes (audit: 56)`);
    assert.ok(hoisted < 4, `the hoisted closure costs ${hoisted} bytes per image (audit: 0)`);
  });
});
