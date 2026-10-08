// The cut's worlds stand at the eye of the cut that reads them: a view drawn aside is cut at its own
// eye, a pose sent with the eye still lands at it — no pass over every placement —, and a root its
// parent stops composing takes back the pose the host holds.
import test from 'node:test'
import assert from 'node:assert/strict'
import { rebaseWorldsOnGpu } from './worldRebase.ts'
import { createCameraFrames } from './frameRanges.ts'
import { FRAME_VEC4 } from './types.ts'
import { cutOnce } from './selectionHelpers.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import type { GpuSelection, SelectionUniforms } from '../core/selection.ts'
import type { AsideCut } from '../core/aside.ts'

const at = (x: number) => ({ cameraWorld: [x, 0, 0] }) as unknown as SelectionUniforms

test('a view drawn aside is cut with the worlds at its own eye, the main view at its own', () => {
  const encoded: number[] = [],
    cut: string[] = []
  const selection = {
    worldsWritten: 0,
    dispatch: () => void cut.push('main'),
    aside: () => ({ dispatch: () => void cut.push('aside') }) as unknown as AsideCut,
    dispose: () => {},
  } as unknown as GpuSelection
  const device = {
    createCommandEncoder: () => ({ finish: () => ({}) }),
    queue: { submit: () => {} },
  } as unknown as GPUDevice
  rebaseWorldsOnGpu(selection, device, {
    encode: (_: unknown, eye: ArrayLike<number>) => void encoded.push(eye[0]),
    dispose: () => undefined,
  })
  const aside = selection.aside()
  selection.dispatch(at(0))
  aside.dispatch(at(5), undefined as unknown as GPUCommandEncoder)
  aside.dispatch(at(5), undefined as unknown as GPUCommandEncoder)
  selection.dispatch(at(0))
  assert.deepEqual(encoded, [0, 5, 0], 'each cut at its own eye, once a move')
  assert.deepEqual(cut, ['main', 'aside', 'aside', 'main'])
})

/** Two placements of one range on a recording device, their worlds absolute. */
function frames() {
  const sources = [3, 1e5 + 0.37].map((x) => ({
    world: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 2, -1e4 - 0.21, 1] },
  }))
  const worlds = new Float32Array(32)
  sources.forEach((source, w) => worlds.set(source.world.elements, w * 16))
  const fake = fakeDevice()
  const table = createCameraFrames(
    fake.device,
    new Float32Array(2 * FRAME_VEC4 * 4),
    2,
    (descriptor) => fake.device.createBuffer(descriptor),
    worlds,
    sources as never,
  )
  return { fake, table, worlds, sources }
}

test('a pose sent with the eye still lands at the eye: no rebase of every placement follows', () => {
  const { fake, table, worlds, sources } = frames()
  const eye = [1e5, 1, -1e4]
  table.worldsAt(eye)
  const written = table.worldsWritten
  sources[1].world.elements[12] += 2.5
  worlds[16 + 12] = sources[1].world.elements[12]
  table.writeWorldOrigins(Int32Array.of(1))
  table.writeNamedWorlds(worlds, Int32Array.of(1), 1)
  assert.equal(table.worldsWritten, written, 'nothing asks the pass over every placement')
  const last = fake.writes.filter((write) => write.size === 64).at(-1)!
  const sent = new Float32Array(last.data.buffer, last.data.byteOffset + last.dataOffset, 16)
  for (let k = 0; k < 3; k++)
    assert.equal(sent[12 + k], Math.fround(sources[1].world.elements[12 + k] - eye[k]), `axis ${k}`)
  assert.equal(
    worlds[16 + 12],
    Math.fround(sources[1].world.elements[12]),
    'the host keeps it whole',
  )
  // Without the eye known — a rebase in flight —, the pose is sent whole and asks the pass.
  table.worldsAt()
  table.writeNamedWorlds(worlds, Int32Array.of(1), 1)
  assert.equal(table.worldsWritten, written + 1)
})

test('a root its parent stops composing takes back the pose the host holds', async () => {
  const { fixture, uniforms, selection } = await cutOnce()
  // Its parent composes it far out of the view on the GPU, words the host never wrote.
  const [range] = selection.worldRanges
  const bytes = (range.buffer as unknown as { data: Uint8Array }).data
  new Float32Array(bytes.buffer, bytes.byteOffset, range.count * 16)[12] = 1000
  selection.composedPlacement?.(0, true)
  selection.worldsMovedOnGpu()
  selection.dispatch(uniforms)
  assert.equal((await selection.flush())?.pageIds.length, 0, 'composed away')
  // Unlinked, the host's pose stands again though the host wrote nothing.
  selection.composedPlacement?.(0, false)
  selection.dispatch(uniforms)
  assert.equal((await selection.flush())?.pageIds.length, 4, 'back at the pose the host holds')
  selection.dispose()
  fixture.geometry.dispose()
})
