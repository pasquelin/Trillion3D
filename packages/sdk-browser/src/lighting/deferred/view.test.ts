import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeferredView } from './view.ts'
import { VIEW_LAYOUT } from './worldAtWgsl.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { AMBIENT_OCCLUSION_PASS } from '../../diagnostic/stage/passLabels.ts'
import { encodeAmbientOcclusion } from '../ao/frame.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { probesRuntime } from './screenProbesRuntime.fixture.ts'

// A frame drawn below the display without the temporal resolve was composed pixel for pixel: the
// composition reads where each display pixel falls in the image drawn (`composeSource`).
test('the source words are its ratio to the display and its last pixel, written when they change', () => {
  const gpu = fakeDevice()
  const view = createDeferredView(gpu.device)
  const written = () => gpu.writes.filter((write) => write.offset === VIEW_LAYOUT.at.source * 4)
  view.writeSource([1, 1], [1, 1])
  assert.equal(written().length, 0, 'at the display size, as made: nothing to write')
  view.writeSource([496, 448], [990, 888])
  assert.deepEqual(
    [...new Float32Array(written()[0].data as ArrayLike<number>)],
    [Math.fround(496 / 990), Math.fround(448 / 888), 495, 447],
  )
  view.writeSource([496, 448], [990, 888])
  assert.equal(written().length, 1, 'the same source writes nothing')
})

/** The frames of a view whose pixels no screen probes light (the level `off`), drawn until the occlusion's programs have compiled. */
async function occlusionRuntime(options: Record<string, unknown> = { screenProbes: 'off' }) {
  const made = await probesRuntime(options)
  const projection = new Float64Array(16),
    world = new Float64Array(16)
  projection[0] = projection[5] = 1.7
  world[0] = world[5] = world[10] = world[15] = 1
  const camera = { projection, world, near: 0.1, far: 1000 } as unknown as EngineCamera
  Object.assign(camera, { perspective: 1 })
  const encode = async () => {
    for (let waited = 0; waited < 100; waited++) {
      const before = made.h.draws.length
      encodeAmbientOcclusion(made.rt, made.h.encoder, camera)
      if (made.h.draws.length > before) return made.h
      await new Promise((done) => setImmediate(done))
    }
    throw new Error('the occlusion never drew')
  }
  /** The mode and the share the lighting was last told: the two words of the view uniform's `views`. */
  const applied = () => {
    const last = made.h.writes.filter((w) => w.offset === (VIEW_LAYOUT.at.views + 1) * 4).at(-1)
    return last ? [...new Float32Array(last.data as ArrayLike<number>)] : []
  }
  const labels = () => made.h.draws.map((d) => String(d.pipeline.label).split(' ').at(-1))
  return { ...made, camera, encode, applied, labels }
}

test('where no screen probes light the image, the occlusion draws its passes in order and tells the lighting how to apply it', async () => {
  const { h, rt, encode, applied, labels } = await occlusionRuntime()
  await encode()
  // The default quality: two resolutions, the shader quality 2 — the setup, the search at the half, the last pass.
  assert.deepEqual(labels(), ['setup', '2sn', '2fu'])
  assert.deepEqual(
    h.passDescriptors.slice(-3).map((pass) => pass.label),
    Array(3).fill(AMBIENT_OCCLUSION_PASS),
  )
  assert.deepEqual(
    h.passes.slice(-3).map((pass) => pass.formats[0]),
    ['rgba16float', 'r8unorm', 'r8unorm'],
  )
  assert.ok(
    rt.gpu.ambientOcclusion!.output && rt.gpu.ambientOcclusion!.bytes > 0,
    'handed over, counted',
  )
  assert.deepEqual(applied(), [1, 1], 'the scene mode, at the static fraction of 1')
  // Each pass's uniform: the radius the half takes grown by the scale once, the scale to the full size, in its words.
  const uniforms = h.writes
    .filter((write) =>
      String((write.buffer as { label?: string })?.label).includes('ambient occlusion pass'),
    )
    .map((write) => [...new Float32Array(new Uint32Array(write.data as ArrayLike<number>).buffer)])
  assert.deepEqual(
    uniforms.map((w) => [+w[4].toFixed(4), w[6]]),
    [
      [0.2125, 2],
      [0.2125, 2],
      [0.125, 1],
    ],
  )
})

test('with the screen probes on, the occlusion draws nothing and holds nothing; asked, and their own off, it draws over their light', async () => {
  const probes = await occlusionRuntime({}),
    textures = probes.h.textures.length
  encodeAmbientOcclusion(probes.rt, probes.h.encoder, probes.camera)
  assert.deepEqual([probes.h.draws.length, probes.h.textures.length - textures], [0, 0])
  // Asked, with their occlusion still on: still none. Asked, and theirs off: over their light, at their strength.
  const both = await occlusionRuntime({ ambientOcclusionWithScreenProbes: true })
  encodeAmbientOcclusion(both.rt, both.h.encoder, both.camera)
  assert.equal(both.h.draws.length, 0)
  const over = await occlusionRuntime({
    ambientOcclusionWithScreenProbes: true,
    screenProbeShortRangeOcclusion: false,
    screenProbeOcclusionIntensity: 0.6,
  })
  await over.encode()
  assert.deepEqual(over.applied(), [2, Math.fround(0.6)])
})

test('the occlusion draws as many resolutions as its settings ask, and gives its textures back when it draws none', async () => {
  const one = await occlusionRuntime({ screenProbes: 'off', ambientOcclusionLevels: 1 })
  await one.encode()
  assert.deepEqual(one.labels(), ['setup', '2fn'], 'the half-size depth map, the last pass')
  const three = await occlusionRuntime({ screenProbes: 'off', ambientOcclusionQuality: 90 })
  await three.encode()
  // Setups of the half and the quarter, their searches, and the last pass: shader quality 4, the six-point set.
  assert.deepEqual(three.labels(), ['setup', 'setup', '4sn', '4su', '4fu'])
  const draws = three.h.draws.length
  three.rt.context.ambientOcclusionIntensity = 0
  encodeAmbientOcclusion(three.rt, three.h.encoder, three.camera)
  assert.equal(three.h.draws.length, draws, 'no pass')
  assert.equal(three.rt.gpu.ambientOcclusion!.bytes, 0, 'no byte')
  assert.deepEqual(three.applied(), [0, 0], 'the lighting applies none')
})
