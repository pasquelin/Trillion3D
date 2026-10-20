// The WebGPU outline: an outline of no object compiles, allocates and draws nothing; one of
// objects chooses exactly the roots their subtrees draw — a runtime mesh's, by its page, and a
// loaded model's node, by the row that places it —, scans then lines the display in two passes
// scissored to where they may show, and gives everything back once the chain holds none.
import test from 'node:test'
import assert from 'node:assert/strict'
import { written } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { commandArgs } from '../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'
import type { ClusterRoot, PageRec } from '../../page/selection/types.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import { OUTLINE_PASS } from '../../stage/passLabels.ts'
import { loaded, recorder } from './webgpuEffects.fixture.ts'
import type { OverlayFrame } from './webgpuKinds.ts'
import { outlineBytes } from './outlineTarget.ts'

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
