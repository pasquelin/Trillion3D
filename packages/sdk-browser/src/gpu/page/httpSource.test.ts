import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { answering, refusedWith } from '../../cluster/answers.fixture.ts';
import { createGpuPageCache, httpPageSource } from './pages.ts';

const BASE = 'https://cache.test/model/pages/';
const { device } = fakeDevice({ limits: { maxBufferSize: 1024 } });

test('a page the server does not hold (404) is refused by its address, the cache asking it once', async (t) => {
  const asked = answering(t, 'p0.bin', [404]);
  const cache = createGpuPageCache(device, httpPageSource(BASE), { pageBytes: 8, slots: 1 });
  // Another request would meet the same refusal.
  await assert.rejects(cache.load('p0.bin'), refusedWith(404, 'p0.bin'));
  assert.equal(asked.length, 1);
  await cache.dispose();
});

test('a page read a busy server refuses once (503) is asked again by the cache, its status reported', async (t) => {
  const asked = answering(t, 'p0.bin', [503, 200], () => new Uint8Array([1, 2, 3, 4]));
  const phases: Array<{ phase: string; context: Record<string, unknown> }> = [];
  const cache = createGpuPageCache(device, httpPageSource(BASE), {
    ...{ pageBytes: 8, slots: 1 },
    onDiagnostic: (event) => phases.push(event),
  });
  const page = await cache.load('p0.bin');
  assert.equal(page.bytes, 4);
  // One request per read: the cache's own retry is the only second one.
  assert.equal(asked.length, 2);
  assert.ok(phases.some((event) => event.phase === 'gpu-page-retry'));
  assert.ok(
    phases.some((event) => event.phase === 'gpu-page-attempt-end' && event.context.status === 503),
  );
  await cache.dispose();
});
