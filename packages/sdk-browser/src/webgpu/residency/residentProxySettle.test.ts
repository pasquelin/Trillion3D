import test from 'node:test'
import assert from 'node:assert/strict'
import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/index.ts'
import { PROXY_LEAF_OWNED } from '../../../../sdk-core/src/scene/core/proxyLeaves.ts'
import { PROXY_STEPS_WORD } from '../../bounce/nodeWgsl.ts'
import { PROXY_HEADER_WORDS } from '../../bounce/sizes.ts'
import { ownedProxy, proxyIdentity } from '../../../../sdk-core/src/scene/core/proxy.fixture.ts'
import { createGpuBounceProxy } from '../../bounce/proxy.ts'
import { fakeDevice, replayWrites } from '../../../../../tests/kit/gpu/fakeDevice.ts'

/** The resident proxy of `ownedProxy`, its words as the GPU holds them, and its write log. */
function resident() {
  const { device, buffers, writes } = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 28, maxBufferSize: 1 << 28 },
  })
  const proxy = ownedProxy()
  const gpu = createGpuBounceProxy(device, proxy)
  const bytes = buffers.find((buffer) => buffer.label?.startsWith('Trillion3D resident proxy'))!
  const words = new Uint32Array(bytes.getMappedRange())
  // Triangles come first, then node bounds, then node children: the leaf's flag word.
  const flag = PROXY_HEADER_WORDS + proxy.data.triangles.length + proxy.data.nodeBounds.length + 1
  /** Writes that reached the triangle column since the last call. */
  const triangleWrites = () =>
    writes.filter(
      (write) =>
        write.offset >= PROXY_HEADER_WORDS * 4 && write.offset < (PROXY_HEADER_WORDS + 9) * 4,
    ).length
  return { gpu, words, writes, flag, triangleWrites }
}

test('a proxy that stops moving settles its triangles and returns to the still path', () => {
  const { gpu, words, writes, flag, triangleWrites } = resident()
  const floats = new Float32Array(words.buffer)
  const moved = proxyIdentity()
  moved[13] = 4
  assert.equal(
    gpu.sync(() => moved),
    'moved',
  )
  assert.equal(triangleWrites(), 0, 'motion keeps geometry')
  replayWrites(words.buffer, writes)
  assert.ok(words[flag] & PROXY_LEAF_OWNED, 'the moved leaf reads its owners')
  assert.equal(
    gpu.sync(() => moved),
    'settled',
  )
  replayWrites(words.buffer, writes)
  assert.equal(gpu.dynamic, false)
  assert.equal(words[flag] & PROXY_LEAF_OWNED, 0, 'rays read no owner word once settled')
  assert.deepEqual(
    [...floats.subarray(PROXY_HEADER_WORDS, PROXY_HEADER_WORDS + 9)],
    [0, 4, 0, 1, 4, 0, 0, 5, 0],
    'the triangle stands at its settled pose',
  )
  assert.equal(words[PROXY_STEPS_WORD], BOUNCE_SETTINGS.traversalSteps + 1, 'the refit bound stays')
})

test('motion every other frame does not re-upload the triangle column each cycle', () => {
  const { gpu, words, writes, flag, triangleWrites } = resident()
  const world = proxyIdentity()
  const uploads: number[] = []
  for (let frame = 0; frame < 16; frame++) {
    if (frame % 2 === 0) world[12] = frame + 1
    gpu.sync(() => world)
    uploads.push(triangleWrites())
    replayWrites(words.buffer, writes)
  }
  // The first settle learns the gap; its resume restores canonical; then motion rides the poses.
  assert.deepEqual(uploads.slice(0, 3), [0, 1, 1])
  assert.ok(
    uploads.slice(3).every((count) => count === 0),
    `${uploads}`,
  )
  assert.ok(words[flag] & PROXY_LEAF_OWNED)
})
