// A moving proxy owner is traced where it is, on a real GPU (#27): the shipped traversal over the
// engine's resident proxy, still then after one of two coincident owners moved
// (`movingProxyPage.ts`). A still proxy hits its canonical plane; once moved, the ray over the new
// pose hits the moved owner — its identity, centre and albedo — and the shadow query agrees.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dansPageWebgpu, empaquetePage as bundlePage } from './pageWebgpu.ts';
import type { run } from './movingProxyPage.ts';

declare global {
  var movingProxy: { run: typeof run };
}

const here = dirname(fileURLToPath(import.meta.url));
const near = (actual: number, expected: number) => Math.abs(actual - expected) < 1e-4;

test('a moved owner is hit at its new pose by the shipped traversal, on the GPU', async () => {
  const script = await bundlePage(resolve(here, 'movingProxyPage.ts'), 'movingProxy');
  const pageErrors: string[] = [];
  const reading = await dansPageWebgpu(() => globalThis.movingProxy.run(), null, {
    script,
    erreursPage: pageErrors,
  });
  assert.equal(reading.unavailable, undefined, 'WebGPU must be available');
  assert.deepEqual([...(reading.errors ?? []), ...pageErrors], []);
  const { compilation, moved, dynamic, still, after } = reading as Exclude<
    typeof reading,
    { unavailable: string }
  >;
  assert.deepEqual(compilation, []);
  // Still: the canonical plane is hit, nothing stands five metres away.
  assert.ok(still[0].found && still[0].blocked && near(still[0].distance, 1));
  assert.ok(!still[1].found && !still[1].blocked, 'no owner stands at the future pose yet');
  assert.ok(moved && dynamic, 'the owner pose reached the resident proxy');
  // Moved: the owner left in place keeps its plane; the moved owner is hit at its new pose.
  assert.ok(after[0].found && after[0].blocked && near(after[0].distance, 1));
  assert.equal(after[0].owner, 0);
  assert.equal(after[0].red, 1, 'the resting owner reads its own white albedo');
  assert.ok(after[1].found && after[1].blocked && near(after[1].distance, 1));
  assert.equal(after[1].owner, 1, 'the ray over the new pose hits the moved owner');
  assert.equal(after[1].red, 0, 'the moved owner reads its own green albedo');
  const centre = [5 + 1 / 3, 1 / 3, 0];
  assert.ok(
    after[1].centre.every((value, axis) => near(value, centre[axis])),
    `centre ${after[1].centre} follows the moved owner`,
  );
});
