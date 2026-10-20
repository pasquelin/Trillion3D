import test from 'node:test'
import assert from 'node:assert/strict'
import { createTemporalAntialiasing } from './temporalAntialiasing.ts'
import { destroyRetired } from '../gpu/core/frameRetire.ts'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'

// Each history carries its colour and, beside it, the share target — the as-is share composition
// reads and the history's validity —: the pass writes both targets, and the bytes it declares count
// them with the analysis's targets and render-resolution histories.
test('each history is a colour and its share target, written together and counted', async () => {
  const { device, textures, renderPipelines } = fakeDevice()
  const temporal = await createTemporalAntialiasing(device, [])
  assert.deepEqual(
    [...renderPipelines[0].fragment!.targets].map((target) => target!.format),
    ['rgba16float', 'rg8unorm'],
  )
  temporal.resize(8, 4, 8, 4)
  // First the 1×1 zero a frame without reactive value reads, then the two histories, then the
  // analysis's targets — the closest depth, the nearest vectors then flicker error, the
  // hole-filled vectors, the reprojection word, the velocity marks, the reprojected shading
  // history, the reprojected flicker history then LDR luma, the rejection, the held measure's
  // filtered input, filtered history and clamp error —, the spatial
  // anti-aliaser's output and the render-resolution histories, one of each: shading, flicker, thin
  // geometry.
  assert.deepEqual(
    textures.map(({ format }) => format),
    [
      'rg8unorm',
      'rgba16float',
      'rg8unorm',
      'rgba16float',
      'rg8unorm',
      'r32uint',
      'r32uint',
      'r32uint',
      'r32uint',
      'rgba8uint',
      'rgba8unorm',
      'rgba8unorm',
      'rgba8unorm',
      'rgba16float',
      'rgba16float',
      'rgba16float',
      'rg8uint',
      'rgba8unorm',
      'rgba8unorm',
      'rgba8uint',
    ],
  )
  // The histories, then the analysis: eight words of targets and three of the held measure's half
  // floats, the anti-aliaser's two bytes, one of each render-resolution history and a
  // perspective's occluder word.
  assert.equal(temporal.historyBytes, 8 * 4 * (2 * 8 + 2 * 2 + (8 * 4 + 3 * 8 + 2 + 12 + 4)))
  temporal.dispose()
})

test('filtered histories fit portable attachment bytes and release every history with their targets', async () => {
  // Every resolve draws, its filtered twin into the most targets.
  const { device, textures, destroyed, renderPipelines } = fakeDevice()
  const temporal = await createTemporalAntialiasing(device, [])
  temporal.resize(8, 4, 8, 4)
  const view = () => ({}) as GPUTextureView,
    buffer = {} as GPUBuffer
  const encoder = device.createCommandEncoder()
  const inputs = { current: view(), depth: view(), ids: view(), pages: buffer, motion: buffer }
  const frame = { ...inputs, pool: buffer, positions: buffer, uvs: buffer }
  temporal.encode(encoder, { ...frame, filter: [view(), view()] }, [8, 4])
  const filtered = () =>
    renderPipelines.filter(({ fragment }) => fragment!.module.label?.endsWith('_FILTERED'))
  while (!filtered().length) await new Promise((done) => setImmediate(done))
  const bytes = new Map<string, number>([
    ['rgba16float', 8],
    ['rg8unorm', 2],
    ['rgba8unorm', 4],
  ])
  // The resolves: the spatial anti-aliaser draws a target of its own.
  const resolves = renderPipelines.filter(({ fragment }) =>
    fragment!.module.label?.startsWith('TAA_RESOLVE'),
  )
  for (const pipeline of resolves) {
    const targets = [...pipeline.fragment!.targets]
    assert.equal(
      targets.length,
      filtered().includes(pipeline) ? 4 : 2,
      'the colour and the share target, and for a filtered one the two layers',
    )
    assert.ok(
      targets.reduce((sum, target) => sum + bytes.get(target!.format)!, 0) <= 32,
      'with the two four-byte display layers, within the portable limit',
    )
  }
  const histories = textures.filter(({ label }) => label?.includes('TAA shading history'))
  assert.equal(histories.length, 1)
  temporal.release()
  assert.equal(temporal.historyBytes, 0)
  // Retired: this image's commands may still name them; destroyed after its submit.
  assert.ok(histories.every((history) => !destroyed.includes(history)))
  destroyRetired(device)
  for (const history of histories) assert.ok(destroyed.includes(history))
  temporal.dispose()
})
