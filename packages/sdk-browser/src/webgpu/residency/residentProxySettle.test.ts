import test from 'node:test';
import assert from 'node:assert/strict';
import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { PROXY_HEADER_WORDS, PROXY_STEPS_WORD } from '../../bounce/nodeWgsl.ts';
import { ownedProxy, proxyIdentity } from '../../../../sdk-core/src/scene/core/proxy.fixture.ts';
import { createGpuBounceProxy } from '../../bounce/proxy.ts';
import { fakeDevice, replayWrites } from '../../../../../tests/kit/gpu/fakeDevice.ts';

test('a proxy that stops moving settles its triangles and returns to the still path', () => {
  const { device, buffers, writes } = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 28, maxBufferSize: 1 << 28 },
  });
  const resident = createGpuBounceProxy(device, ownedProxy());
  const bytes = buffers.find((buffer) => buffer.label?.startsWith('Trillion3D resident proxy'))!;
  const words = new Uint32Array(bytes.getMappedRange()),
    floats = new Float32Array(words.buffer);
  const moved = proxyIdentity();
  moved[13] = 4;
  assert.equal(
    resident.sync(() => moved),
    true,
  );
  assert.ok(
    !writes.some((write) => write.offset === PROXY_HEADER_WORDS * 4),
    'motion keeps geometry',
  );
  replayWrites(words.buffer, writes);
  assert.equal(words[11], 1);
  assert.equal(
    resident.sync(() => moved),
    true,
  );
  replayWrites(words.buffer, writes);
  assert.equal(resident.dynamic, false);
  assert.equal(words[11], 0, 'rays read no owner word once settled');
  assert.deepEqual(
    [...floats.subarray(PROXY_HEADER_WORDS, PROXY_HEADER_WORDS + 9)],
    [0, 4, 0, 1, 4, 0, 0, 5, 0],
    'the triangle stands at its settled pose',
  );
  assert.equal(
    words[PROXY_STEPS_WORD],
    BOUNCE_SETTINGS.traversalSteps + 1,
    'the refit bound stays',
  );
});
