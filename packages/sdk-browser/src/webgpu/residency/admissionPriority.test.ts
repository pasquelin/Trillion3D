import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { createGpuPageCache } from '../../gpu/page/pages.ts';
import { createReadWatch } from '../../streaming/readWatch.ts';
import { createWebgpuPageTracking } from '../row/pageTracking.ts';
import { createWebgpuResidentEnsurer } from './residentEnsurer.ts';
import { ensurerOptions, pageOf } from './residentEnsurer.fixture.ts';
import type { PageRec } from '../../page/selection/selection.ts';

test('a lower tier admitted by the WebGPU pool stays out of the loading total (#408)', async () => {
  // The streamer's read watch, over reads that land at once: what `onProgress` counts as `total`.
  const { read, watch } = createReadWatch(async () => new Uint8Array(4));
  const { device } = fakeDevice({ limits: { maxBufferSize: 1024 } });
  const cache = createGpuPageCache(device, { read }, { pageBytes: 4, slots: 4 });
  const camera = pageOf('camera'),
    ahead = pageOf('ahead');
  const tracking = createWebgpuPageTracking([camera, ahead]);
  tracking.wanted.add(tracking.keyOf(camera), camera);
  const ensure = createWebgpuResidentEnsurer({
    ...ensurerOptions(tracking, cache),
    lowerTiers: () => [{ pages: [ahead], has: (key) => key === tracking.keyOf(ahead) }],
    // The reads started ahead of each pass go to the same watch, as `readGeometryAhead` does.
    prefetch: (rec: PageRec, signal, priority) => void read(rec.url, signal, priority),
  });
  const progress = watch(() => {});
  await ensure([camera], 1, 1);
  progress.stop();
  assert.ok(cache.get('camera') && cache.get('ahead'), 'both pages admitted');
  assert.deepEqual(
    progress.reads(),
    { landed: 1, asked: 1 },
    'the view read the camera page alone',
  );
});
