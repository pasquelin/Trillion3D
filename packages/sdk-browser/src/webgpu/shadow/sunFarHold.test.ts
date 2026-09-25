// GEO-02, second origin: the far shadow adopts its proxy at a promise's resolution, therefore
// between two images, without any step of the current image writing it. Without a revision, two
// identical images froze the far surface with no cast shadow even though the proxy was there.
// `ensureSunFarShadow` now increments resources and breaks the hold on every adoption, borrowed as
// loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSunFarShadow } from '../pages/prepare/sunFar.ts';
import { createFrameGateCore } from '../../frame/gateCore.ts';
import { createWebgpuSunFarState } from '../pages/state/sunFar.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import type { SceneProxy } from '../../../../sdk-core/src/index.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** Resident proxy as the cache returns it: empty columns are enough for adoption. */
const sceneProxy = () =>
  ({
    bounds: [0, 0, 0, 1, 1, 1],
    cellMetres: 0.5,
    errorMetres: 0.1,
    bytes: 0,
    triangles: 0,
    nodes: 0,
    data: {
      triangles: new Float32Array(0),
      albedo: new Uint32Array(0),
      nodeBounds: new Float32Array(0),
      nodeChildren: new Uint32Array(0),
    },
  }) as unknown as SceneProxy;

/** `rt` reduced to what `ensureSunFarShadow` reads and writes: state, counts and the hold. */
function sunFarRt(readSceneProxy?: () => Promise<SceneProxy>) {
  const run = { gate: createFrameGateCore(1) };
  // One kept image then a second identical one: the hold is armed and stable, as before adopting a
  // proxy in a scene that no longer moves.
  run.gate.hold.keep(run.gate.revisions);
  run.gate.hold.keep(run.gate.revisions);
  const rt = {
    run,
    sunFar: createWebgpuSunFarState(),
    bounce: { probes: undefined as unknown, wanted: false, reason: null as string | null },
    context: { readSceneProxy },
    capabilities: { unsupported: [] as string[] },
    diag: { engineDiagnostic() {}, diagnosticFailure() {} },
  };
  return rt as unknown as WebgpuPagesRuntime & typeof rt;
}

/** What an adoption must have produced: a fitted proxy, one more counter, a broken hold. */
function assertAdoption(rt: ReturnType<typeof sunFarRt>, before: number) {
  assert.ok(rt.sunFar.gpu?.proxy, 'the proxy is fitted');
  assert.equal(
    rt.run.gate.revisions.resources,
    before + 1,
    'the adopted proxy is one more resource',
  );
  // `resourcesChanged()` does not touch `stable` — a historical fact on the last two kept images —
  // but breaks `same()`, therefore `held()`: it is `held()` that `holdWebgpuFrame` consults to decide
  // whether to redo the image.
  assert.equal(rt.run.gate.held(), false, 'the hold is broken');
  assert.equal(rt.run.gate.hold.same(rt.run.gate.revisions), false, 'the revisions have moved');
}

test('GEO-02: the proxy loaded for the far shadow announces its adoption', async () => {
  const rt = sunFarRt(async () => sceneProxy());
  assert.equal(rt.run.gate.hold.stable, true, 'the hold is armed before adoption');
  const before = rt.run.gate.revisions.resources;
  ensureSunFarShadow(rt, fakeDevice().device);
  await rt.sunFar.pending;
  assertAdoption(rt, before);
});

test('GEO-02: the proxy borrowed from bounce also announces its adoption', () => {
  const rt = sunFarRt();
  const emprunte = { bounds: [0, 0, 0, 1, 1, 1], cellMetres: 0.5, nodeCount: 1 };
  rt.bounce.probes = { proxy: emprunte } as unknown as WebgpuPagesRuntime['bounce']['probes'];
  const before = rt.run.gate.revisions.resources;
  ensureSunFarShadow(rt, fakeDevice().device);
  assert.equal(rt.sunFar.borrowed, true, 'the bounce proxy is borrowed, never reloaded');
  assertAdoption(rt, before);
});
