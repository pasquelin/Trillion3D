import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneDraw } from './sceneDraw.ts';
import { createTestContext } from '../core/testContext.fixture.ts';
import { createExplorerMaterialApi } from '../../world/api/materialApi.ts';
import { bitmapFixture } from '../../world/api/bitmap.fixture.ts';
import * as G from '../../host/graph/graph.fixture.ts';
import type { BackendDiagnostic, RenderBackend } from '../../backend/types.ts';

test('WebGL runtime material uses the existing bitmap upload, publishes cost and deletes its texture', async (t) => {
  const bitmap = bitmapFixture(t),
    image = bitmap(4, 2),
    gl = createTestContext();
  const diagnostics: BackendDiagnostic[] = [];
  const scene = new G.Scene();
  const draw = createSceneDraw(gl.gl, scene, [], { onDiagnostic: (d) => diagnostics.push(d) });
  const backend = { ...draw.materials } as RenderBackend;
  const api = createExplorerMaterialApi({
    check() {},
    source: scene,
    associations: new Map(),
    backends: [backend],
    active: () => backend,
  });
  try {
    const made = await api.createMaterial({ map: image });
    const uploads = gl.of('texImage2D').filter((args) => args.includes(image));
    assert.equal(uploads.length, 1);
    assert.deepEqual(uploads[0].slice(2), ['SRGB8_ALPHA8', 'RGBA', 'UNSIGNED_BYTE', image]);
    const cost = diagnostics.find((d) => d.phase === 'material-texture-appended')!.context;
    assert.equal(cost.count, 1);
    assert.equal(cost.bytes, 32);
    assert.ok(Number(cost.ms) >= 0);
    const before = gl.of('deleteTexture').length;
    api.dropMaterial(made.id);
    assert.equal(gl.of('deleteTexture').length, before + 1);
    assert.equal(api.materialMapBytes(), 0);
    assert.equal(image.closed, false);
  } finally {
    draw.dispose();
  }
});
