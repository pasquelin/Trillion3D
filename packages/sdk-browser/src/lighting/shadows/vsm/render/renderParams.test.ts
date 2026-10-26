// The parameters of the raster's view passes (`VsmRenderParams`): what each pass's slot carries of
// the frame — which casters a sun's far-shadow test reaches, the draw distances the casters take,
// the main view's filter — and where the slots lie on a device that aligns its uniforms wider. (The
// chunks of rows these slots were once laid by are gone: one cull and one raster a view pass.)
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { commandArgs } from '../../../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import type { VsmRenderScene } from './renderPass.ts'
import {
  encodeLights,
  encodeRows,
  LOW_DISPATCH,
  manyLights,
  compiled,
  paramWords,
} from '../recordingRaster.fixture.ts'
import {
  VSM_RENDER_ARGS_BIN,
  VSM_RENDER_ARGS_SOFTWARE,
  VSM_RENDER_PARAMS,
} from './renderParamsWgsl.ts'
import { vsmRenderCandidatesWgsl } from './renderCandidatesWgsl.ts'
import { vsmRenderCullWgsl } from './renderCullWgsl.ts'
import { vsmLayout } from '../layout.ts'
import { vsmRenderComputePipes } from './renderPipes.ts'
import { vsmDescentPipes } from '../traversal/traversalPass.ts'
import { bindingsOutsideLayouts } from '../recordingRaster.fixture.ts'

import {
  MOBILITY_FAR_SHADOW,
  MOBILITY_FAR_SKIPPED,
  MOBILITY_FAR_TESTED,
} from '../../mobilityBits.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import {
  DRAW_DISTANCE_MARK,
  DRAW_INSTANCE_MARK,
  DRAW_FAR_WORD,
  DRAW_NEAR_WORD,
  MARK_WORD,
} from '../../../../geometry/dag/frameTable.ts'
import { f32Bits } from '../../../../../../math/src/float/bits.ts'
import { functionsOf, wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'

const LIMITS = { maxStorageBufferBindingSize: 1 << 27, maxBufferSize: 1 << 27 }

/** The raster of the 200 000 rows under `scene` on a device of `limits`: the device, what the
 *  encoding returned and the words of the parameter slots, `stride` words apart. */
function encoded(scene: Partial<VsmRenderScene>, limits: Record<string, number> = {}) {
  const fake = fakeDevice({ limits: { ...LIMITS, ...limits } })
  const stats = encodeRows(fake.device, fake.device.createCommandEncoder(), scene)
  return { fake, stats, ...paramWords(fake) }
}

test('a device aligning at 512 lays the view passes’ parameter slots 512 bytes apart', async () => {
  // A sun and 200 point lights on a device whose dispatches have 500 rows: three view passes.
  const { fake, stats } = await encodeLights(
    manyLights(200),
    {},
    {
      ...LIMITS,
      ...LOW_DISPATCH,
      minUniformBufferOffsetAlignment: 512,
    },
  )
  // Every group set with a dynamic offset: the passes' parameters, the candidates' at 0.
  const offsets = new Set(
    [...fake.computePasses, ...fake.passes]
      .flatMap(({ commands }) => commandArgs(commands, 'setBindGroup'))
      .flatMap(([, , dynamic]) =>
        (dynamic as number[] | undefined)?.length ? [(dynamic as number[])[0]] : [],
      ),
  )
  assert.equal(stats.passes, 3)
  assert.deepEqual(
    [...offsets].sort((a, b) => a - b),
    Array.from({ length: stats.passes }, (_, p) => p * 512),
  )
})

test('every view pass’s parameters say which casters a sun’s far-shadow test reaches', () => {
  for (const farMeshes of [undefined, false, true]) {
    const { stats, words, stride } = encoded({ farMeshes })
    for (let c = 0; c < stats.passes; c++)
      assert.equal(words[c * stride + VSM_RENDER_PARAMS.at.farMeshes], farMeshes ? 1 : 0, `${c}`)
  }
})

test('every view pass’s parameters say which draw distances the casters take, and their scale', () => {
  const cases = [
    [undefined, 0],
    [{ scale: 1, instances: false }, 1],
    [{ scale: 2.5, instances: true }, 3],
  ] as const
  for (const [drawDistance, flags] of cases) {
    const { stats, words, stride } = encoded({ drawDistance })
    const floats = new Float32Array(words.buffer),
      { at } = VSM_RENDER_PARAMS
    for (let c = 0; c < stats.passes; c++) {
      // Bit 0 the objects of their own, bit 1 the instances of an instanced mesh.
      assert.equal(words[c * stride + at.drawDistances], flags, `${c}`)
      assert.equal(floats[c * stride + at.viewDistanceScale], drawDistance?.scale ?? 1, `${c}`)
    }
  }
})

test('the main view’s filter reaches the candidates: its buffer in their group, its first word in every view pass’s parameters', () => {
  const frames = {} as GPUTextureView
  const [cold, clusters, worlds] = [{}, {}, {}] as GPUTextureView[]
  for (const base of [undefined, 12]) {
    const fake = fakeDevice({ limits: LIMITS })
    const bits = fake.device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE })
    const filter = base === undefined ? undefined : { buffer: bits, base }
    const encoder = fake.device.createCommandEncoder()
    const { passes } = encodeRows(fake.device, encoder, {
      world: { cold, frames, clusters, worlds, filter },
    })
    const bound = fake.bindGroups.filter(({ entries }) =>
      [...entries].some(({ resource }) => resource === frames),
    )
    assert.ok(bound.length > 0)
    for (const { entries } of bound) {
      const held = [...entries][2].resource as { buffer: GPUBuffer }
      assert.equal(held.buffer === bits, base !== undefined, 'the buffer, or a stand-in word')
    }
    const { words, stride } = paramWords(fake)
    for (let c = 0; c < passes; c++)
      assert.equal(words[c * stride + VSM_RENDER_PARAMS.at.filterBase], base ?? 0, `${c}`)
  }
})

test('every view pass’s parameters carry the radius threshold, squared: none where it is 0 or absent', () => {
  for (const radiusThreshold of [undefined, 0, 0.05]) {
    const { stats, words, stride } = encoded({ radiusThreshold })
    const floats = new Float32Array(words.buffer)
    for (let c = 0; c < stats.passes; c++)
      assert.equal(
        floats[c * stride + VSM_RENDER_PARAMS.at.radiusThresholdSq],
        Math.fround((radiusThreshold ?? 0) ** 2),
        `${c}`,
      )
  }
})

// The software half of the raster (`renderSoftwareWgsl.ts`) runs in the view pass's compute pass,
// once its bin sorted its records first: a group a record from its own indirect arguments, every
// record into the pool's slice 0, then the static layer's into the static slice. Without the page
// rows' compute twin no cluster is handed to it: the edge it is judged by is zero.
test('the software half runs after each bin over its records, off without its page rows', async () => {
  const page = { layout: {} as GPUBindGroupLayout, group: {} as GPUBindGroup }
  for (const pageCompute of [undefined, page]) {
    const fake = fakeDevice({ limits: LIMITS })
    const stats = (await compiled(fake, () =>
      encodeRows(fake.device, fake.device.createCommandEncoder(), {
        pageCompute,
        hardwareEdge: 32,
      }),
    ))!
    const { words, stride } = paramWords(fake)
    const floats = new Float32Array(words.buffer)
    for (let c = 0; c < stats.passes; c++)
      assert.equal(floats[c * stride + VSM_RENDER_PARAMS.at.hardwareEdge], pageCompute ? 32 : 0)
    const order = fake.dispatches.map(({ entryPoint, offset }) => `${entryPoint}@${offset ?? ''}`)
    const bin = order.indexOf(`vsmRenderBin@${VSM_RENDER_ARGS_BIN * 4}`)
    const software = `@${VSM_RENDER_ARGS_SOFTWARE * 4}`
    assert.ok(bin > 0)
    assert.deepEqual(
      order.slice(bin + 1),
      pageCompute ? [`vsmRenderSoftware${software}`, `vsmRenderSoftwareStatic${software}`] : [],
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
  const run = shaderRun<{ vsmRenderScreenRatio: (object: number[]) => number }>(
    candidates,
    ['vsmRenderScreenRatio'],
    wgslConstants(candidates),
  )
  assert.equal(run.vsmRenderScreenRatio([499.75, 0, 0, 50]), 2500 / 499.75 ** 2)
  assert.equal(run.vsmRenderScreenRatio([529.75, 0, 0, 120]), 14400 / 529.75 ** 2)
  assert.equal(run.vsmRenderScreenRatio([0, 0, 0, 5]), 3.4028234663852886e38)
  // The candidate kernel gives every candidate its ratio; the cull tests it first of a view's work.
  assert.ok(candidates.includes('flags,farDepth,vsmRenderScreenRatio(object),'))
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

test('a caster whose object is out of the draw distances it names casts no shadow, from the main view’s eye', () => {
  const candidates = vsmRenderCandidatesWgsl()
  // Placements 4 and 7 name 10 to 100 metres (7 an instance); placement 5 names none (its mark has no bit).
  const named = (w: number, mark: number): [string, number][] => [
    [`${w} ${MARK_WORD}`, mark],
    [`${w} ${DRAW_NEAR_WORD}`, f32Bits(10)],
    [`${w} ${DRAW_FAR_WORD}`, f32Bits(100)],
  ]
  const words = new Map([
    ...named(4, DRAW_DISTANCE_MARK),
    ...named(7, DRAW_DISTANCE_MARK | DRAW_INSTANCE_MARK),
    ...named(5, 0),
  ])
  const run = (params: object) =>
    shaderRun<{
      vsmRenderOutsideDrawDistance: (w: number, delta: number[]) => boolean
    }>(candidates, ['vsmRenderOutsideDrawDistance'], {
      ...wgslConstants(candidates),
      params,
      markOf: (w: number) => words.get(`${w} ${MARK_WORD}`) ?? 0,
      framesWord: (w: number, k: number) => words.get(`${w} ${k}`) ?? 0,
    })
  const on = run({ drawDistances: 1, viewDistanceScale: 1 })
  const out = (w: number, distance: number) => on.vsmRenderOutsideDrawDistance(w, [distance, 0, 0])
  assert.equal(out(4, 50), false, 'within its distances')
  assert.equal(out(4, 5), true, 'nearer than its nearest')
  assert.equal(out(4, 101), true, 'past its farthest')
  assert.equal(out(5, 5000), false, 'a placement that names none, whatever its words hold')
  assert.equal(out(6, 5000), false, 'nor one whose words are zero')
  const scaled = run({ drawDistances: 1, viewDistanceScale: 2 })
  assert.equal(scaled.vsmRenderOutsideDrawDistance(4, [150, 0, 0]), false, 'the scale doubles it')
  const off = run({ drawDistances: 0, viewDistanceScale: 1 })
  assert.equal(off.vsmRenderOutsideDrawDistance(4, [5000, 0, 0]), false, 'the parameters say none')
  // Bit 0 the objects of their own, bit 1 the instances: the host's switch takes the second away.
  const both = run({ drawDistances: 3, viewDistanceScale: 1 })
  for (const [kernel, w, is] of [
    [on, 4, true],
    [on, 7, false],
    [both, 7, true],
    [both, 4, true],
  ] as const)
    assert.equal(kernel.vsmRenderOutsideDrawDistance(w, [5000, 0, 0]), is, `${w}, ${kernel === on}`)
  // The candidate kernel takes it at the centre of the object, after the level of detail, before the
  // far-shadow depth.
  {
    const code = vsmRenderCandidatesWgsl()
    const call = 'vsmRenderOutsideDrawDistance(w,object.xyz)'
    assert.ok(code.indexOf(call) > code.indexOf('drawsCompared(true'), 'after the level of detail')
    assert.ok(code.indexOf(call) < code.indexOf('atomicAdd(&counts[0]'), 'before the append')
  }
  assert.equal(VSM_RENDER_PARAMS.at.drawDistances !== undefined, true, 'the parameters carry it')
})

// Every compute pipeline of the raster binds what its entry reaches, whatever branch a run takes:
// WebGPU validates the module's static use against the layout — the cull with no test reaches the
// occlusion's group through the cull of a view, and binds a blank one.
test('every raster pipeline’s layout holds the bindings its entry reaches', () => {
  const fake = fakeDevice({ limits: LIMITS })
  const pipes = vsmRenderComputePipes(fake.device, vsmLayout({ fullMapCapacity: 7 }))
  for (const pipe of [pipes.cull, pipes.cullFirst, pipes.cullSecond, pipes.cullPost, pipes.bin])
    void pipe.pipeline
  void pipes.views.pipeline
  const descent = vsmDescentPipes(fake.device, vsmLayout({ fullMapCapacity: 7 }))
  for (const pipe of [
    descent.views,
    descent.prepare,
    ...descent.levels,
    descent.postPrepare,
    descent.postNodes,
    descent.close,
    descent.arm,
  ])
    void pipe.pipeline
  assert.deepEqual(bindingsOutsideLayouts(fake), [])
})
