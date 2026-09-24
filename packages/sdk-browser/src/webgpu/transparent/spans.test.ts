import test from 'node:test';
import { MANIFEST_IDENTITY } from '../../backend/pagesBackend.fixture.ts';
import assert from 'node:assert/strict';
import { createWebgpuPagesRuntime } from '../pages/runtime.ts';
import { prepareWebgpuPages } from '../pages/prepare/prepare.ts';
import { ensurePageTable } from '../pages/render/encodeDraws.ts';
import { refreshTransparentSpans } from './spans.ts';
import { disposeWebgpuPages } from '../pages/io/metrics.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mixedBinScene } from '../pages/testScenes.fixture.ts';

test('transparent spans follow only changed resident pages through arrival, eviction and slot reuse', async () => {
  installGpuGlobals();
  const scene = mixedBinScene(),
    mock = mockGpu();
  scene.metadata.primitives[1].pass = 'clustered-blend';
  scene.both.transparent = true;
  const rt = createWebgpuPagesRuntime({
    ...scene,
    metadata: { ...scene.metadata, ...MANIFEST_IDENTITY },
    gpuDevice: mock.device,
    maxResidentPages: 4,
    viewport: [32, 32],
  });
  try {
    await prepareWebgpuPages(rt, mock.device);
    ensurePageTable(rt, mock.device);
    const table = rt.blendState.table!;
    assert.ok(
      table.spans.every((v) => v === 0),
      'no unverified resident span at allocation',
    );
    const spans = () =>
      mock.writes.filter((w) => w.label === 'Trillion3D transparent cluster spans');
    const flush = () => {
      mock.writes.length = 0;
      rt.services.syncRows();
      refreshTransparentSpans(rt);
      return spans();
    };
    assert.equal(
      flush().reduce((n, w) => n + w.bytes.length, 0),
      8,
      'only one real entry, no padding',
    );
    assert.equal(flush().length, 0);
    rt.gpu.cache!.unpin('0');
    rt.gpu.cache!.unload('0');
    assert.equal(flush().length, 0, 'opaque eviction writes no transparent span');
    rt.gpu.cache!.unpin('1');
    rt.gpu.cache!.unload('1');
    assert.equal(flush()[0]?.bytes.length, 8);
    assert.ok(
      table.spans.every((v) => v === 0),
      'an evicted page cannot read the next slot owner',
    );
    await rt.gpu.cache!.load('1');
    assert.equal(flush()[0]?.bytes.length, 8);
    assert.equal(table.spans[1], 3);
    assert.equal(flush().length, 0);
  } finally {
    await disposeWebgpuPages(rt);
    scene.geoA.dispose();
    scene.geoB.dispose();
    scene.front.dispose();
    scene.both.dispose();
  }
});
