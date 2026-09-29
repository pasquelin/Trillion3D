import test from 'node:test';
import assert from 'node:assert/strict';
import { bitmapFixture } from '../../../world/api/bitmap.fixture.ts';
import { createExplorerMaterialApi } from '../../../world/api/materialApi.ts';
import { GraphTexture } from '../../../host/graph/texture.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { camera, quadScene } from '../testScenes.fixture.ts';
import { webgpuPagesBackend } from '../pages.ts';
import type { BackendDiagnostic } from '../../../backend/types.ts';

/** Record the source and flags of the real scratch upload, without pretending to rasterize pixels. */
function open(map?: ImageBitmap) {
  installGpuGlobals();
  const gpu = mockGpu(),
    copies: unknown[] = [],
    diagnostics: BackendDiagnostic[] = [];
  gpu.device.queue.copyExternalImageToTexture = (source, destination, size) => {
    copies.push({ source, premultipliedAlpha: destination.premultipliedAlpha, size });
  };
  const fixture = quadScene();
  if (map) {
    const texture = new GraphTexture(map);
    texture.flipY = false;
    texture.colorSpace = 'srgb';
    fixture.material.map = texture;
  }
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: gpu.device,
    viewport: [32, 32],
    onDiagnostic: (d) => diagnostics.push(d),
  });
  const api = createExplorerMaterialApi({
    check() {},
    ...fixture,
    backends: [backend],
    active: () => backend,
  });
  return { ...gpu, fixture, backend, api, copies, diagnostics };
}

test('a bitmap after open uses the same source, texel extent and upload flags as at open', async (t) => {
  const bitmap = bitmapFixture(t),
    image = bitmap(4, 2);
  const imported = open(image),
    runtime = open();
  try {
    await imported.backend.prepare();
    await runtime.backend.prepare();
    const baseline = runtime.backend.metrics().textureResidentBytes;
    const made = await runtime.api.createMaterial({ map: image });
    assert.deepEqual(runtime.copies, imported.copies);
    assert.deepEqual(runtime.copies, [
      { source: { source: image, flipY: false }, premultipliedAlpha: false, size: [4, 2] },
    ]);
    assert.equal(runtime.api.assignMaterial('0/0', made.id), true);
    assert.equal(
      runtime.api.setMaterial(made.id, { tiling: [2, 3] }),
      true,
      'runtime ownership is indexed safely',
    );
    runtime.backend.render(camera());
    const uploaded = runtime.diagnostics.find((d) => d.phase === 'material-texture-appended')!;
    assert.equal(uploaded.context.uploadedBytes, 32);
    assert.equal(uploaded.context.scratchBuilds, 1);
    assert.ok(Number(uploaded.context.uploadMs) >= 0);
    runtime.api.assignMaterial('0/0', runtime.api.createMaterial().id);
    const allocated = runtime.buffers.length;
    runtime.api.dropMaterial(made.id);
    assert.equal(runtime.buffers.length, allocated, 'drop allocates no GPU buffers');
    assert.equal(runtime.api.materialMapBytes(), 0);
    assert.equal(runtime.backend.metrics().textureResidentBytes, baseline);
    const size = () =>
      runtime.buffers.filter((b) => b.label === 'Trillion3D texture pages color').at(-1)!.size;
    const emptySize = size();
    for (let i = 0; i < 3; i++) {
      const next = await runtime.api.createMaterial({ map: image });
      runtime.api.dropMaterial(next.id);
      assert.equal(size(), emptySize, 'retired slots are reused; metadata does not accumulate');
    }
  } finally {
    await imported.backend.dispose();
    await runtime.backend.dispose();
  }
});

test('a failed bitmap upload releases its pinned place and a later admission succeeds', async (t) => {
  const bitmap = bitmapFixture(t),
    opened = open(),
    { backend, api, device } = opened;
  try {
    await backend.prepare();
    const before = backend.metrics().textureResidentBytes;
    const copy = device.queue.copyExternalImageToTexture;
    device.queue.copyExternalImageToTexture = () => {
      throw new Error('bad bitmap');
    };
    await assert.rejects(api.createMaterial({ map: bitmap() }), /bad bitmap/);
    assert.equal(api.materialMapBytes(), 0);
    assert.equal(backend.metrics().textureResidentBytes, before);
    device.queue.copyExternalImageToTexture = copy;
    const made = await api.createMaterial({ map: bitmap() });
    assert.equal(api.assignMaterial('0/0', made.id), true);
  } finally {
    await backend.dispose();
  }
});

test('queued bitmap admissions reject after device loss or disposal without leaking map bytes', async (t) => {
  const bitmap = bitmapFixture(t);
  for (const stop of ['loss', 'dispose']) {
    const opened = open();
    await opened.backend.prepare();
    if (stop === 'loss') opened.lose('test loss');
    else await opened.backend.dispose();
    const before = opened.textures.length;
    const pending = [
      opened.api.createMaterial({ map: bitmap() }),
      opened.api.createMaterial({ map: bitmap() }),
    ];
    const results = await Promise.allSettled(pending);
    assert.ok(results.every((result) => result.status === 'rejected'));
    assert.equal(opened.api.materialMapBytes(), 0);
    assert.equal(opened.textures.length, before, 'a stopped device receives no new texture');
    if (stop === 'loss') await opened.backend.dispose();
  }
});
