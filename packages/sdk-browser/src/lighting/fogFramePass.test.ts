// The fog pass in the frame: its stand-ins, the images a volume takes to settle, the blend of the pass and
// where the frame lays it, and the order of the steps that build the volume. Split from `fogWiring.test.ts`.
import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createDeferredPlaceholders } from './deferred/setup.ts'
import { unsettledMask, unsettledReasons } from '../frame/loop/unsettled.ts'
import { settledRt } from '../frame/loop/hold.fixture.ts'
import { historyHorizon } from './fog/layout.ts'
import { HEIGHT_FOG_PASS } from '../diagnostic/stage/passLabels.ts'
import { createHeightFogPass } from './fog/fogPass.ts'
import { encodeHeightFog } from '../frame/render/encodeHeightFog.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'

test('the fog’s stand-ins are made when a program first reads them, once, and let go with the others', () => {
  const gpu = fakeDevice()
  const standIns = () => gpu.textures.filter((t) => t.label?.startsWith('Trillion3D fog no'))
  const placeholders = createDeferredPlaceholders(gpu.device)
  assert.equal(standIns().length, 0, 'a scene with no fog makes none')
  const { fog } = placeholders
  assert.equal(standIns().length, 2, 'the cubemap and the volume')
  assert.equal(placeholders.fog, fog, 'the same object on every read')
  assert.equal(standIns().length, 2)
  placeholders.dispose()
  assert.ok(standIns().every((t) => gpu.destroyed.includes(t)))
})

test('a volume still blending its history keeps the view drawn; once whole, the view may hold', () => {
  const rt = settledRt()
  type Held = NonNullable<typeof rt.gpu.fogVolume>
  rt.gpu.fogVolume = { gpu: { settling: true } } as unknown as Held
  assert.deepEqual(unsettledReasons(unsettledMask(rt)), ['fogVolume'])
  rt.gpu.fogVolume = { gpu: { settling: false } } as unknown as Held
  assert.equal(unsettledMask(rt), 0, 'a whole history is a steady state')
})

test('the images a volume takes to settle follow its history’s share', () => {
  const horizon = (share: number, uses = true) =>
    historyHorizon({ volumetricFogUsesHistory: uses, volumetricFogHistoryShare: share })
  // 0.9 per image: 0.9^53 is under a 256th, 0.9^52 is not.
  assert.equal(horizon(0.9), 53)
  assert.ok(horizon(0.5) < horizon(0.9) && horizon(0.9) < horizon(0.99))
  assert.deepEqual([horizon(0.9, false), horizon(0), horizon(1), horizon(1.5)], [1, 1, 1, 1])
})

test('the fog pass keeps what lies in the image by the transmittance and adds the inscattering, drawn when its pipeline is compiled', async () => {
  const gpu = fakeDevice()
  const failures: unknown[] = []
  const pass = createHeightFogPass(gpu.device, {} as GPUBuffer, true, (error) =>
    failures.push(error),
  )
  assert.deepEqual(failures, [])
  const targets = gpu.renderPipelines.find(({ label }) => label === HEIGHT_FOG_PASS)?.fragment
    ?.targets as GPUColorTargetState[] | undefined
  assert.equal(targets?.length, 1)
  const blend = targets?.[0]?.blend
  assert.deepEqual(
    blend?.color,
    { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
    'what lies in the image is kept by the transmittance, the inscattering added',
  )
  assert.deepEqual(
    blend?.alpha,
    { operation: 'add', srcFactor: 'zero', dstFactor: 'one-minus-src-alpha' },
    'the image’s alpha, the share of the background left visible, kept the same way',
  )
  assert.equal(pass.ready, false, 'a frame that finds the pipeline not compiled draws no fog')
  pass.release()
})

test('the frame lays the fog pass over the lit image only where the image shows a fog, an atmosphere or a local fog volume', () => {
  const laid: GPUTextureView[] = []
  const hdr = {} as GPUTextureView
  const runtime = ({
    unlit = false,
    diagnostic = 'beauty',
    fog = false,
    local = 0,
    usesContract = true,
  } = {}) =>
    ({
      lights: { store: { unlit, environment: fog ? { fog: {} } : {} } },
      run: { diagnostic },
      gpu: {
        hdrView: hdr,
        localFog: { plan: { count: local } },
        deferred: { usesContract, fog: (_: unknown, view: GPUTextureView) => laid.push(view) },
      },
    }) as unknown as WebgpuPagesRuntime
  const encoder = {} as GPUCommandEncoder
  const lays = (rt: WebgpuPagesRuntime, air = false) => {
    laid.length = 0
    encodeHeightFog(rt, encoder, air)
    return laid.length === 1
  }
  assert.equal(lays(runtime()), false, 'no fog, no air, no volume: nothing to lay')
  assert.equal(lays(runtime({ fog: true })), true, 'the scene’s fog')
  assert.equal(lays(runtime({ local: 2 })), true, 'a local fog volume')
  assert.equal(lays(runtime(), true), true, 'the haze of an atmosphere')
  assert.equal(lays(runtime({ fog: true, unlit: true })), false, 'the unlit view shows no fog')
  assert.equal(lays(runtime({ fog: true, usesContract: false })), false, 'no lit program yet')
  assert.equal(
    lays(runtime({ fog: true, diagnostic: 'normals' })),
    false,
    'a view that paints raw values',
  )
})

test('the frame builds the fog volume once the indirect light made the translucency volume it reads, and the light shafts’ mask after the fog’s view block', () => {
  const source = readFileSync(new URL('../frame/render/preLight.ts', import.meta.url), 'utf8')
  // The translucency volume is made in the indirect light's step (`encodeIndirectLight`), defined below the frame's steps.
  const indirect = source.slice(source.indexOf('function encodeIndirectLight('))
  assert.ok(
    indirect.includes('encodeTranslucencyGi(rt, device, encoder, cam)'),
    'the indirect light makes the volume',
  )
  const order = [
    'encodeIndirectLight(rt, device, encoder, cam, overrides)',
    'encodeFogVolume(rt, device, compute.begin(encoder), cam, direct)',
    'encodeLightShaftOcclusion(rt, device, encoder, cam)',
  ].map((call) => source.indexOf(call))
  assert.ok(
    order.every((at) => at >= 0),
    `each is called: ${order}`,
  )
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
    'in this order',
  )
  assert.equal(source.indexOf('encodeFogVolume('), source.lastIndexOf('encodeFogVolume('))
})
