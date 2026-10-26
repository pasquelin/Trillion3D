import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createShadeBins } from './shadeBins.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import { createPresentClasses, noteClass, presentClassKeys } from '../../gpu/core/presentClasses.ts'

const binBuffers = (buffers: { label?: string; size: number }[], label: string) =>
  buffers.filter((made) => made.label === `Trillion3D shading bins ${label}`)

test('more classes than the start capacity grow the counters and dispatches, the old ones retired', async () => {
  installGpuGlobals()
  const { device, buffers, destroyed } = fakeDevice()
  const bins = await createShadeBins(device as unknown as GPUDevice)
  const [work, args] = [binBuffers(buffers, 'counters')[0], binBuffers(buffers, 'dispatches')[0]]
  bins.assign(
    Array.from({ length: 256 }, (_, i) => i),
    false,
  )
  assert.equal(binBuffers(buffers, 'counters').length, 1, 'the start capacity holds 256 bins')
  bins.assign(
    Array.from({ length: 300 }, (_, i) => 2 * i),
    false,
  )
  const [grownWork] = binBuffers(buffers, 'counters').slice(-1)
  assert.equal(binBuffers(buffers, 'counters').length, 2)
  assert.equal(grownWork.size, (1 + 2 * 512) * 4)
  assert.equal(binBuffers(buffers, 'dispatches').at(-1)!.size, 512 * 3 * 4)
  assert.equal(destroyed.includes(work), false, 'the old counters live until the frame submits')
  destroyRetired(device as unknown as GPUDevice)
  assert.equal(destroyed.includes(work), true)
  assert.equal(destroyed.includes(args), true)
})

test('the present classes list their keys in increasing order, in the same array', () => {
  const present = createPresentClasses()
  for (const key of [9, 3, 7]) noteClass(present, key, 1)
  const keys = presentClassKeys(present)
  assert.deepEqual(keys, [3, 7, 9])
  noteClass(present, 7, -1)
  noteClass(present, 5, 1)
  assert.equal(presentClassKeys(present), keys)
  assert.deepEqual(keys, [3, 5, 9])
})
