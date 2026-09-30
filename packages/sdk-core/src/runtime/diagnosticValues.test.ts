import assert from 'node:assert/strict';
import test from 'node:test';
import { DIAGNOSTICS } from './diagnostics.ts';
import { stageLabel, STAGE_LABELS } from './stageProfile.ts';
import { CAMERA_SCENARIOS } from './paths.ts';
import { createExplorerDiagnosticApi } from '../../../sdk-browser/src/world/api/diagnosticApi.ts';
import type { RenderBackend } from '../../../sdk-browser/src/backend/types.ts';

test('supported diagnostics reach the backend while unsupported views are refused with a useful explanation', () => {
  const modes: string[] = [];
  const backend = {
    id: 'webgpu-page-raster',
    setDiagnostic(mode: string) {
      modes.push(mode);
    },
  } as unknown as RenderBackend;
  const api = createExplorerDiagnosticApi({
    check() {},
    active: () => backend,
    backends: [backend],
    beautyMaterials: new Map(),
    overlays: [],
    setMode() {},
  });
  for (const mode of [
    'beauty',
    'wireframe',
    'clusters',
    'lod',
    'screen-error',
    'materials',
    'visibility',
    'pages',
  ] as const) {
    api.setDiagnostic(mode);
    assert.equal(modes.at(-1), mode);
  }
  for (const mode of ['texture-mip', 'overdraw'] as const) {
    const count = modes.length;
    assert.throws(
      () => api.setDiagnostic(mode),
      (error) => error instanceof Error && error.message.trim().length > 0,
    );
    assert.equal(modes.length, count);
  }
  for (const capability of Object.values(DIAGNOSTICS)) {
    assert.equal(typeof capability.available, 'boolean');
    assert.ok(capability.reason.trim().length > 0);
  }
});

test('stage labels and scenario descriptions can be displayed without empty or ambiguous entries', () => {
  const labels = Object.keys(STAGE_LABELS).map(stageLabel);
  assert.ok(labels.every((label) => label.trim().length > 0));
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(stageLabel('host-custom-stage'), 'host-custom-stage');
  assert.ok(Object.isFrozen(STAGE_LABELS));
  const ids = CAMERA_SCENARIOS.map((scenario) => scenario.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.trim().length > 0));
  assert.ok(
    CAMERA_SCENARIOS.every(
      (scenario) => typeof scenario.available === 'boolean' && scenario.scope.trim().length > 0,
    ),
  );
  for (const id of ['visibility-jump', 'memory-pressure', 'long-session', 'pop-in', 'stop-resume'])
    assert.equal(CAMERA_SCENARIOS.find((scenario) => scenario.id === id)?.available, false);
});
