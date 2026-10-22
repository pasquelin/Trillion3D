// The WebGPU outline: an outline of no object compiles, allocates and draws nothing; one of
// objects chooses exactly the roots their subtrees draw — a runtime mesh's, by its page, and a
// loaded model's node, by the row that places it —, scans then lines the display in two passes
// scissored to where they may show, and gives everything back once the chain holds none. The depth of
// field's cases follow on the same kit: its circle of confusion, its plan, its bokeh and its passes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { dispatchedEntries, written } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { commandArgs } from '../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'
import type { ClusterRoot, PageRec } from '../../geometry/selection/types.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import { OUTLINE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { frameOf, input, loaded, recorder } from './webgpuEffects.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { resolveDepthOfField } from '../../../../sdk-core/src/contracts/depthOfFieldOptions.ts'
import { DEPTH_OF_FIELD_RULES } from '../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { cocRadiusAt, compileCocModel } from './depthOfField/cocModel.ts'
import { compileBokehModel } from './depthOfField/bokehModel.ts'
import { planDepthOfField } from './depthOfField/dofPlan.ts'
import { setupHalfShader } from './depthOfField/dofSetupWgsl.ts'
import type { OverlayFrame } from './webgpuKinds.ts'
import { outlineBytes } from './outline/outlineTarget.ts'

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** A scene of two groups: `a` holds a mesh and a loaded model's node, `b` a mesh. Its roots: `a`'s
 *  own page, its mesh's, `b`'s, and a row the node owns. */
function scene() {
  const top = new Object3D(),
    a = new Object3D(),
    mesh = new Object3D(),
    node = new Object3D(),
    b = new Object3D()
  a.add(mesh, node)
  top.add(a, b)
  const world = { elements: IDENTITY }
  const drawn = (source: Object3D) => ({ pages: [{ drawSource: { node: source } }], world })
  const rows = { sources: [node] }
  const roots = [
    drawn(a),
    drawn(mesh),
    drawn(b),
    { pages: [], placement: { rows, index: 0 }, world },
  ] as unknown as ClusterRoot<PageRec>[]
  return { a, b, mesh, node, roots }
}

async function outlined() {
  const { gpu, effects } = await loaded()
  const { a, b, mesh, node, roots } = scene()
  const view = (format: GPUTextureFormat) =>
    gpu.device.createTexture({ size: [64, 32], format, usage: 0x10 | 0x04 }).createView()
  const frame: OverlayFrame = {
    display: view('rgba8unorm'),
    presentation: undefined,
    size: [64, 32],
    pixelRatio: 2,
    ids: view('r32uint'),
    idSize: [32, 16],
    pages: gpu.device.createBuffer({ size: 256, usage: 0x80 }),
    layout: { selectionRoots: roots, rootIndex: { revision: 0 } },
    viewProj: IDENTITY,
    revisions: { scene: 1, view: 1, resources: 1 },
  }
  const madeBefore = gpu.textures.length
  return { gpu, effects, frame, a, b, mesh, node, roots, madeBefore }
}

/** The words the chosen buffer last received. */
const chosenWords = (gpu: Awaited<ReturnType<typeof loaded>>['gpu']) => {
  const write = gpu.writes.filter((w) => w.buffer.label === `${OUTLINE_PASS} chosen`).at(-1)
  return write && [...(written(write) as Uint32Array)]
}

test('an outline of no object compiles, allocates and draws nothing', async () => {
  const { gpu, effects, frame, madeBefore } = await outlined()
  const outline = effect.outline()
  assert.equal(outline.idle, true)
  const { encoder, passes } = recorder(gpu)
  assert.equal(effects.overlay(encoder, [outline], frame), 0)
  await effects.settled()
  assert.equal(effects.overlay(encoder, [outline], frame), 0)
  assert.deepEqual(
    [passes.length, gpu.renderPipelines.length, gpu.textures.length - madeBefore, effects.bytes],
    [0, 0, 0, 0],
  )
})

test("an outline chooses exactly its objects' subtrees: their pages and their rows", async () => {
  const { gpu, effects, frame, a, b, node } = await outlined()
  const outline = effect.outline({ objects: [a] })
  const { encoder, passes } = recorder(gpu)
  assert.equal(effects.overlay(encoder, [outline], frame), 0, 'compiling: nothing yet')
  await effects.settled()
  assert.equal(effects.overlay(encoder, [outline], frame), 2)
  // `a`, its mesh and its node's row: roots 0, 1 and 3; never `b`'s, root 2.
  assert.deepEqual(chosenWords(gpu), [0b1011])
  assert.deepEqual(
    passes
      .map((p) => [p.label, commandArgs(p.commands, 'setPipeline')[0][0]])
      .map(([l, p]) => [l, (p as GPURenderPipelineDescriptor).fragment?.entryPoint]),
    [
      [OUTLINE_PASS, 'across'],
      [OUTLINE_PASS, 'over'],
    ],
    'the scan, then the line over the display',
  )
  assert.equal(passes[0].colors[0]?.loadOp, 'clear')
  assert.equal(passes[1].colors[0]?.loadOp, 'load', 'drawn over the image')
  assert.equal(effects.bytes, outlineBytes(64, 32))
  const writes = gpu.writes.length
  effects.overlay(encoder, [outline], frame)
  assert.equal(gpu.writes.length, writes, 'the same selection and settings write nothing')
  outline.objects = [node]
  effects.overlay(encoder, [outline], frame)
  assert.deepEqual(chosenWords(gpu), [0b1000], 'a loaded node alone: its row')
  // The row's node moves under `b`: the selection follows once the scene says it changed.
  b.add(node)
  effects.overlay(encoder, [outline], frame)
  assert.deepEqual(chosenWords(gpu), [0b1000], 'kept while no revision moved')
  outline.objects = [b]
  effects.overlay(encoder, [outline], frame)
  assert.deepEqual(chosenWords(gpu), [0b1100], 'a new list is taken again')
  a.add(node) // back under `a`
  effects.overlay(encoder, [outline], frame)
  assert.deepEqual(chosenWords(gpu), [0b1100], 'still the list taken, until the scene moves')
  frame.revisions.scene++
  effects.overlay(encoder, [outline], frame)
  assert.deepEqual(chosenWords(gpu), [0b0100], 'the scene moved: taken again')
  outline.objects = [b, node]
  effects.overlay(encoder, [outline], frame)
  assert.deepEqual(chosenWords(gpu), [0b1100])
})

test('the line is the thickness in display pixels, in the colour as written', async () => {
  const { gpu, effects, frame, a } = await outlined()
  const outline = effect.outline({ objects: [a], color: '#ff0000', thickness: 3 })
  const { encoder } = recorder(gpu)
  effects.overlay(encoder, [outline], frame)
  await effects.settled()
  effects.overlay(encoder, [outline], frame)
  const uniform = () => {
    const write = gpu.writes.filter((w) => w.buffer.label === `${OUTLINE_PASS} uniform`).at(-1)!
    const { buffer } = written(write)
    return { floats: [...new Float32Array(buffer, 0, 9)], reach: new Int32Array(buffer)[9] }
  }
  // Three CSS pixels at two display pixels each; the identifiers drawn at half the display.
  assert.deepEqual(uniform(), { floats: [1, 0, 0, 1, 0.5, 0.5, 32, 16, 6], reach: 6 })
  outline.color.set('#000000')
  outline.thickness = 1.5
  effects.overlay(encoder, [outline], frame)
  assert.deepEqual(uniform(), { floats: [0, 0, 0, 1, 0.5, 0.5, 32, 16, 3], reach: 3 })
})

test('both passes are scissored to where the roots may show; off screen, none runs', async () => {
  const { gpu, effects, frame, b, roots } = await outlined()
  // `b` bounded by a box whose image covers the display's centre, a tenth of each side.
  const box = new Float64Array([-0.1, -0.1, 0.5, 0.1, 0.1, 0.5])
  Object.assign(roots[2], { localBox: box })
  const outline = effect.outline({ objects: [b], thickness: 1 })
  const { encoder, passes } = recorder(gpu)
  effects.overlay(encoder, [outline], frame)
  await effects.settled()
  effects.overlay(encoder, [outline], frame)
  const rects = passes.map((p) => commandArgs(p.commands, 'setScissorRect')[0])
  // The box spans x 28.8..35.2, y 14.4..17.6: 28..36 × 14..18, grown by the reach (2) and the
  // jitter's pixel and more: 4 across, 8 down for the scan, which the line's column reads.
  assert.deepEqual(rects, [
    [24, 6, 16, 20],
    [24, 10, 16, 12],
  ])
  passes.length = 0
  box.set([5, 5, 0.5, 6, 6, 0.5])
  frame.revisions.scene++ // the root moved
  assert.equal(effects.overlay(encoder, [outline], frame), 0, 'past the display')
  assert.equal(passes.length, 0)
})

test('a chain that holds no outline any more gives its target back', async () => {
  const { gpu, effects, frame, a, madeBefore } = await outlined()
  const outline = effect.outline({ objects: [a] })
  const { encoder } = recorder(gpu)
  effects.overlay(encoder, [outline], frame)
  await effects.settled()
  effects.overlay(encoder, [outline], frame)
  assert.ok(effects.bytes > 0)
  outline.objects = []
  effects.overlay(encoder, [outline], frame)
  assert.equal(effects.bytes, 0, 'an emptied outline frees its target')
  destroyRetired(gpu.device)
  for (const texture of gpu.textures.slice(madeBefore))
    assert.ok(gpu.destroyed.includes(texture), texture.label)
})

/** A 1920 × 1080 image through the fixture's 40-degree vertical field. */
const VIEW = { width: 1920, height: 1080, cotHorizontal: 1.5455, cotVertical: 2.7474774 }
const LIMITS = { maxForeground: 0.025, maxBackground: 0.025 }
const lensOf = (options: object) => compileCocModel(resolveDepthOfField(options), VIEW, LIMITS)
const planOf = (options: object, settings: object = {}) =>
  planDepthOfField({
    ...VIEW,
    volume: resolveDepthOfField(options),
    settings: resolveSettings(DEPTH_OF_FIELD_RULES, settings),
    image: [1920, 1080],
    extent: [1920, 1080],
    near: 0.1,
  })
const close = (a: number, b: number, message: string, within = 1e-6) =>
  assert.ok(Math.abs(a - b) < within, `${message}: ${a} against ${b}`)

test('a circle of confusion is the thin lens’s, and the shader reads the same model', () => {
  const model = lensOf({ focusDistance: 2, aperture: 2 })
  // The circle at infinity, f² / (N (F − f)) across, as a share of the sensor's width (24.576 mm).
  const f = 0.5 * (0.024576 / (16 / 9)) * VIEW.cotVertical
  const infinity = (f * f) / (2 * (2 - f)) / 2 / 0.024576
  close(model.infinityRadius, infinity, 'at infinity', 1e-9)
  close(cocRadiusAt(model, 10, 1920), 0.8 * infinity * 1920, 'behind the focus')
  close(cocRadiusAt(model, 1, 1920), -infinity * 1920, 'in front of it: negative')
  assert.equal(cocRadiusAt(model, 0.01, 1920), -0.025 * 1920, 'held to the largest foreground')
  // Depth blur alone: a lens with no focus blurs the background, half its radius at 1 km.
  const blur = lensOf({ depthBlurRadius: 6 })
  close(cocRadiusAt(blur, 1000, 1920), 6, 'half the depth blur at 1 km')
  assert.equal(cocRadiusAt(lensOf({}), 5, 1920), 0, 'no focus, no blur: no circle')
  for (const lens of [lensOf({ focusDistance: 2, aperture: 2, depthBlurRadius: 4 }), blur]) {
    const { infinityRadius, minForeground, maxBackground, depthBlurRadius } = lens
    const view = {
      coc: [infinityRadius, minForeground, maxBackground, depthBlurRadius],
      lens: [1, 1, lens.depthBlurExponent, lens.focusDistance],
    }
    const { cocOfDepth } = shaderRun<{ cocOfDepth: (depth: number, basis: number) => number }>(
      setupHalfShader(),
      ['cocOfDepth'],
      { view },
    )
    // The focus itself too, where the radius is nil and the depth blur alone remains.
    for (const depth of [0.01, 1, lens.focusDistance || 3, 10, 1e4])
      close(cocOfDepth(depth, 960), cocRadiusAt(lens, depth, 960), `${depth} m`, 1e-4)
  }
})

test('the plan draws nothing under a pixel of blur, and gathers the layers the circles need', () => {
  assert.equal(planOf({}).idle, true, 'no focus, no depth blur')
  assert.equal(planOf({ depthBlurRadius: 0.02 }).idle, true, 'a blur under 1/20 of a pixel')
  const wide = planOf({ focusDistance: 1, aperture: 1.2 })
  assert.deepEqual([wide.gather, wide.tiles, wide.mips], [[960, 540], [120, 68], 2])
  assert.equal(wide.maxForeground, 0.025 * 960, 'the nearest depth drawn, held to the largest')
  assert.equal(wide.convolutions.map((c) => c.layer).join(), 'foreground,hole,slight,background')
  // Circles of 24 texels reach 4 tiles: a pass reads 3, so a second pass spreads the last one.
  assert.equal(
    wide.dilations.map((d) => d.mode + d.radius).join(),
    'minMax3,minMax1,minAbs3,minAbs1',
  )
  assert.equal(planOf({ depthBlurRadius: 6 }).convolutions.length, 3, 'a background alone')
  const narrow = planOf({ focusDistance: 5, aperture: 32 })
  assert.deepEqual(narrow.dilations, [{ mode: 'standalone', radius: 1, multiplier: 1 }])
  const full = planOf({ focusDistance: 1, aperture: 1.2 }, { depthOfFieldGatherDivisor: 1 })
  assert.deepEqual([full.gather, full.maxForeground], [[1920, 1080], 48])
  const low = planOf({ focusDistance: 1, aperture: 1.2 }, { depthOfFieldAccumulator: 'low' })
  assert.deepEqual([low.mips, low.convolutions[0].quality], [wide.mips + 1, 0])
})

test('a bokeh has the area of the circle: a polygon of blades, rounded ones between', () => {
  const bokeh = (aperture: number, minAperture: number, bladeCount = 5) =>
    compileBokehModel(resolveDepthOfField({ aperture, minAperture, bladeCount }), 1)
  assert.equal(bokeh(1.2, 1.2).shape, 'circle', 'wide open')
  const six = bokeh(1.2, 0, 6) // the corners at R = √(2π / (6 sin 60°)), the sides at R cos 30°
  close(six.circumscribed, Math.sqrt(Math.PI / 3 / Math.sin(Math.PI / 3)), 'corners', 1e-12)
  close(six.incircle, six.circumscribed * Math.cos(Math.PI / 6), 'sides', 1e-12)
  const [near, mid, far] = [1.25, 4, 32].map((aperture) => bokeh(aperture, 1.2))
  assert.ok(near.circumscribed < mid.circumscribed && mid.circumscribed < far.circumscribed)
  assert.ok(near.incircle > mid.incircle && mid.incircle > far.incircle)
  close(near.circumscribed, 1, 'a little stopped down: almost the circle', 0.01)
  close(far.circumscribed, bokeh(32, 0).circumscribed, 'stopped far down: straight', 0.01)
})

test('the depth of field draws nothing until it has a focus, then every pass in its order', async () => {
  const { gpu, effects } = await loaded()
  const off = effect.depthOfField(),
    on = effect.depthOfField({ focusDistance: 2, aperture: 2 })
  const frame = frameOf(gpu, 640, 360)
  const { encoder } = recorder(gpu)
  assert.deepEqual([off.idle, on.idle], [true, false])
  assert.equal(effects.resolve(encoder, [off], input, frame), input)
  assert.deepEqual([effects.bytes, gpu.computePipelines.length], [0, 0], 'no pass, no cost')
  assert.equal(effects.readyResolved([on]), false, 'its programs compile')
  await effects.settled()
  assert.equal(effects.resolve(encoder, [on], input, frame), input, 'unblurred while compiling')
  await new Promise((resolve) => setTimeout(resolve))
  assert.notEqual(effects.resolve(encoder, [on], input, frame), input)
  assert.ok(effects.bytes > 0 && effects.resolvedPasses >= 2)
  assert.equal(
    [...new Set(dispatchedEntries(gpu.dispatches))].join(),
    'setupHalf,flattenCoc,dilateCoc,downsampleCoc,reduceLevels,packScatter,buildLut,gatherLayer,postfilterLayer,recombine',
  )
  assert.equal(effects.resolve(encoder, [], input, frame), input)
  assert.equal(effects.bytes, 0, 'a chain with none gives its images back')
})
