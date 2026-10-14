// The rows the CPU names for a shadow change where they stand go to the GPU as a list, their count
// first, and one dispatch stales them from the rows pass's spheres (`namedCasts.ts`); a command
// buffer holding it that is dropped stales every page instead, never one fewer.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { createCastChanges, nameCastRow } from './castChanges.ts'
import { clusterSpheres } from './rowBuffers.ts'
import { encodeNamedCasts, namedCastsDropped } from './namedCasts.ts'
import { NAMED_CASTS_ENTRY } from './namedCastsWgsl.ts'

function session() {
  const fake = fakeDevice(),
    { device } = fake
  const boxes: number[][] = []
  const lights = {
    casts: createCastChanges(device),
    spheres: clusterSpheres(device, 8),
    mobilityRows: device.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE }),
    changes: { worldChanged: (min: number[], max: number[]) => void boxes.push([...min, ...max]) },
  }
  const rt = { lights, run: { gpuComputeDispatches: 0 } } as unknown as WebgpuPagesRuntime
  return { fake, device, rt, casts: lights.casts, boxes }
}

/** One compute pass of `encoder` the named rows are staled in. */
function encode(rt: WebgpuPagesRuntime, device: GPUDevice, encoder: GPUCommandEncoder) {
  const pass = encoder.beginComputePass()
  encodeNamedCasts(rt, device, encoder, pass)
  pass.end()
}

test('the named rows go up with their count first, staled by one dispatch, then forgotten', () => {
  const { fake, device, rt, casts } = session()
  nameCastRow(casts, 2)
  nameCastRow(casts, 5)
  encode(rt, device, device.createCommandEncoder())
  const sent = fake.writes.filter(({ buffer }) => buffer === casts.named.buffer)
  assert.equal(sent.length, 1)
  assert.deepEqual([...new Uint32Array(sent[0].data as ArrayLike<number>)].slice(0, 3), [2, 2, 5])
  const staled = fake.dispatches.filter(({ entryPoint }) => entryPoint === NAMED_CASTS_ENTRY)
  assert.equal(staled.length, 1)
  assert.equal(rt.run.gpuComputeDispatches, 1)
  assert.equal(casts.named.count, 0, 'the list emptied')
  encode(rt, device, device.createCommandEncoder())
  assert.equal(rt.run.gpuComputeDispatches, 1, 'no row named, no dispatch')
})

test('a dropped command buffer that held the named rows stales every page once', () => {
  const { device, rt, casts, boxes } = session()
  nameCastRow(casts, 1)
  const held = device.createCommandEncoder()
  encode(rt, device, held)
  namedCastsDropped(rt.lights, device.createCommandEncoder())
  assert.equal(boxes.length, 0, 'another buffer dropped: nothing')
  namedCastsDropped(rt.lights, held)
  assert.equal(boxes.length, 1)
  assert.deepEqual(boxes[0], [-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity])
  namedCastsDropped(rt.lights, held)
  assert.equal(boxes.length, 1, 'once')
})
