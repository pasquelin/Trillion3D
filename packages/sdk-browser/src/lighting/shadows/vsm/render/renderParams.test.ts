// The parameters of the raster's chunks (`VsmRenderParams`): what each chunk's slot carries of the
// frame — which casters a sun's far-shadow test reaches, the draw distances the casters take, the
// main view's filter — and where the slots lie on a device that aligns its uniforms wider
// (`render/renderChunks.test.ts` runs the chunks' work).
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { commandArgs } from '../../../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import type { VsmRenderScene } from './renderPass.ts'
import { encodeRows, paramWords } from '../recordingRaster.fixture.ts'
import { VSM_RENDER_PARAMS } from './renderParamsWgsl.ts'
import { vsmRenderCandidatesWgsl } from './renderCandidatesWgsl.ts'
import { vsmRenderCullWgsl } from './renderCullWgsl.ts'
import { vsmTransmissionCandidatesWgsl } from '../transmission/transmissionClearWgsl.ts'
import { vsmLayout } from '../layout.ts'
import {
  MOBILITY_FAR_SHADOW,
  MOBILITY_FAR_SKIPPED,
  MOBILITY_FAR_TESTED,
} from '../../mobilityBits.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { functionsOf, wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'

const LIMITS = { maxStorageBufferBindingSize: 1 << 27, maxBufferSize: 1 << 27 }

/** The raster of the 200 000 rows under `scene` on a device of `limits`: the device, what the
 *  encoding returned and the words of the parameter slots, `stride` words apart. */
function encoded(scene: Partial<VsmRenderScene>, limits: Record<string, number> = {}) {
  const fake = fakeDevice({ limits: { ...LIMITS, ...limits } })
  const stats = encodeRows(fake.device, fake.device.createCommandEncoder(), scene)
  return { fake, stats, ...paramWords(fake) }
}

test('a device aligning at 512 lays the chunks’ parameter slots 512 bytes apart', () => {
  const { fake, stats, words } = encoded({}, { minUniformBufferOffsetAlignment: 512 })
  const { chunks } = stats
  // Every group set with a dynamic offset: the chunks' parameters, the candidates' at 0.
  const offsets = new Set(
    [...fake.computePasses, ...fake.passes]
      .flatMap(({ commands }) => commandArgs(commands, 'setBindGroup'))
      .flatMap(([, , dynamic]) =>
        (dynamic as number[] | undefined)?.length ? [(dynamic as number[])[0]] : [],
      ),
  )
  // Chunk c's index at its word of its slot, 128 words a slot; its groups bound at c × 512.
  for (let c = 0; c < chunks; c++)
    assert.equal(words[c * 128 + VSM_RENDER_PARAMS.at.chunk], c, `chunk ${c}`)
  assert.deepEqual(
    [...offsets].sort((a, b) => a - b),
    Array.from({ length: chunks }, (_, c) => c * 512),
  )
})

test('every chunk’s parameters say which casters a sun’s far-shadow test reaches', () => {
  for (const farMeshes of [undefined, false, true]) {
    const { stats, words, stride } = encoded({ farMeshes })
    for (let c = 0; c < stats.chunks; c++)
      assert.equal(words[c * stride + VSM_RENDER_PARAMS.at.farMeshes], farMeshes ? 1 : 0, `${c}`)
  }
})

test('every chunk’s parameters say whether the casters take the draw distances, and their scale', () => {
  for (const drawDistance of [undefined, { scale: 1 }, { scale: 2.5 }]) {
    const { stats, words, stride } = encoded({ drawDistance })
    const floats = new Float32Array(words.buffer),
      { at } = VSM_RENDER_PARAMS
    for (let c = 0; c < stats.chunks; c++) {
      assert.equal(words[c * stride + at.drawDistances], drawDistance ? 1 : 0, `${c}`)
      assert.equal(floats[c * stride + at.viewDistanceScale], drawDistance?.scale ?? 1, `${c}`)
    }
  }
})

test('the main view’s filter reaches the candidates: its buffer in their group, its first word in every chunk’s parameters', () => {
  const frames = {} as GPUTextureView
  for (const base of [undefined, 12]) {
    const fake = fakeDevice({ limits: LIMITS })
    const bits = fake.device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE })
    const filter = base === undefined ? undefined : { buffer: bits, base }
    const encoder = fake.device.createCommandEncoder()
    const { chunks } = encodeRows(fake.device, encoder, { world: { frames, filter } })
    const bound = fake.bindGroups.filter(({ entries }) =>
      [...entries].some(({ resource }) => resource === frames),
    )
    assert.ok(bound.length > 0)
    for (const { entries } of bound) {
      const held = [...entries][2].resource as { buffer: GPUBuffer }
      assert.equal(held.buffer === bits, base !== undefined, 'the buffer, or a stand-in word')
    }
    const { words, stride } = paramWords(fake)
    for (let c = 0; c < chunks; c++)
      assert.equal(words[c * stride + VSM_RENDER_PARAMS.at.filterBase], base ?? 0, `${c}`)
  }
})

test('every chunk’s parameters carry the radius threshold, squared: none where it is 0 or absent', () => {
  for (const radiusThreshold of [undefined, 0, 0.05]) {
    const { stats, words, stride } = encoded({ radiusThreshold })
    const floats = new Float32Array(words.buffer)
    for (let c = 0; c < stats.chunks; c++)
      assert.equal(
        floats[c * stride + VSM_RENDER_PARAMS.at.radiusThresholdSq],
        Math.fround((radiusThreshold ?? 0) ** 2),
        `${c}`,
      )
  }
})

test('a map redrawn whole leaves out a caster whose object spans too little of the main view', () => {
  const candidates = vsmRenderCandidatesWgsl()
  const cull = vsmRenderCullWgsl(vsmLayout({ fullMapCapacity: 7, sunMapCapacity: 3 }))
  const culled = shaderRun<{
    vsmRadiusCulled: (ratio: number, thresholdSq: number, uncached: boolean) => boolean
  }>(cull, ['vsmRadiusCulled'], wgslConstants(cull)).vsmRadiusCulled
  // Radius over distance under 0.05: 10 m of radius at 400 m is 0.025, 30 m at 400 m is 0.075.
  const [small, large] = [(10 / 400) ** 2, (30 / 400) ** 2]
  assert.equal(culled(small, 0.05 ** 2, true), true, 'too small, redrawn whole: left out')
  assert.equal(culled(large, 0.05 ** 2, true), false, 'large enough')
  assert.equal(culled(small, 0.05 ** 2, false), false, 'a cached map keeps its pages')
  assert.equal(culled(small, 0, true), false, 'threshold 0: none')
  // The ratio is the whole object's radius squared over its squared distance from the main view's
  // eye; the greatest float at its centre, so that it is never left out there.
  const run = shaderRun<{
    vsmRenderScreenRatio: (c: number[], l: number[], lod: object) => number
  }>(candidates, ['vsmRenderObjectDelta', 'vsmRenderScreenRatio'], {
    ...wgslConstants(candidates),
    params: { eyeHigh: [100, 0, 0], eyeLow: [0.5, 0, 0] },
  })
  const alone = { object: [0, 0, 0, 0] },
    object = { object: [30, 0, 0, 120] }
  assert.equal(run.vsmRenderScreenRatio([600, 0, 0, 50], [0.25, 0, 0], alone), 2500 / 499.75 ** 2)
  assert.equal(run.vsmRenderScreenRatio([600, 0, 0, 50], [0.25, 0, 0], object), 14400 / 529.75 ** 2)
  assert.equal(run.vsmRenderScreenRatio([100, 0, 0, 5], [0.5, 0, 0], alone), 3.4028234663852886e38)
  // Both candidate kernels give every candidate its ratio; the cull tests it first of a view's work.
  for (const code of [candidates, vsmTransmissionCandidatesWgsl()])
    assert.ok(code.includes('flags,farDepth,vsmRenderScreenRatio(s.c,s.l.xyz,lod))'))
  const view = functionsOf(cull, ['vsmRenderCullView'])
  const test = 'if(vsmRadiusCulled(cand.screenRatio,params.radiusThresholdSq,pd.uncached)){return;}'
  assert.ok(view.includes(test) && view.indexOf(test) < view.indexOf('vsmBoxInView('), 'first')
})

test('an object says whether a sun’s far-shadow test reaches it, over the view’s rule: reached, never reached, or as the view says', () => {
  const candidates = vsmRenderCandidatesWgsl()
  const consts = wgslConstants(candidates)
  const worldPlaced = (placement: number) => placement === 7
  const flags = (farMeshes: number) =>
    shaderRun<{ vsmRenderFarFlags: (word: number, placement: number) => number }>(
      candidates,
      ['vsmRenderFarFlags'],
      { ...consts, worldPlaced, params: { farMeshes } },
    ).vsmRenderFarFlags
  const [TESTED, CASTS_FAR] = [consts.VSM_RENDER_CAND_FAR_TESTED, consts.VSM_RENDER_CAND_FAR_CAST]
  const [REACHED, NEVER] = [MOBILITY_FAR_TESTED, MOBILITY_FAR_SKIPPED]
  for (const farMeshes of [0, 1]) {
    const read = flags(farMeshes)
    assert.equal(read(REACHED, 3), TESTED, `view ${farMeshes}: an object drawn as itself, reached`)
    assert.equal(read(REACHED, 7), TESTED, `view ${farMeshes}: a world placement, reached`)
    assert.equal(read(NEVER, 3), 0, `view ${farMeshes}: an object drawn as itself, never reached`)
    assert.equal(read(NEVER, 7), 0, `view ${farMeshes}: a world placement, never reached`)
    assert.equal(read(NEVER | MOBILITY_FAR_SHADOW, 7), CASTS_FAR, 'casting far, as it says')
  }
  assert.deepEqual(
    [flags(0)(0, 3), flags(0)(0, 7), flags(1)(0, 3)],
    [0, TESTED, TESTED],
    'as before',
  )
})
