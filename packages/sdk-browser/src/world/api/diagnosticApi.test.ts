import test from 'node:test';
import assert from 'node:assert/strict';
import type { DiagnosticMode } from '../../../../sdk-core/src/index.ts';
import { families } from '../../host/families.ts';
import { createExplorerDiagnosticApi } from './diagnosticApi.ts';

test("a view of a host graph repaints once the views' code arrived; beauty first loads none", async () => {
  let mode: DiagnosticMode = 'beauty',
    repainted = 0;
  const backend = { id: 'witness', hostDiagnostics: {}, scene: { traverse: () => repainted++ } };
  const api = createExplorerDiagnosticApi({
    check() {},
    active: () => backend as never,
    backends: [backend as never],
    beautyMaterials: new Map(),
    overlays: [],
    setMode: (next) => void (mode = next),
  });
  api.setDiagnostic('beauty');
  await families.diagnostics.settled();
  assert.deepEqual([repainted, families.diagnostics.arrived], [0, false], 'nothing to undo');
  api.setDiagnostic('wireframe');
  assert.deepEqual(
    [repainted, mode],
    [0, 'wireframe'],
    'the view waits for its code, as its frames',
  );
  await families.diagnostics.settled();
  await new Promise((wake) => setImmediate(wake));
  assert.equal(repainted, 1, 'repainted on its arrival');
  api.setDiagnostic('beauty');
  assert.equal(repainted, 2, 'arrived, a view repaints at once');
});
