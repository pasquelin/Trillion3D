// S10: the texture feedback — a 4 B/px target, its clear, its writes and the reduction each image —
// is a textured scene's alone. A scene that wears no texture has no tile to ask for: it makes no
// target and draws with the pipelines that write none; a texture that comes later brings the target
// in place, beside the others, which are not remade.
import assert from 'node:assert/strict'
import test from 'node:test'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { MATERIAL_SURFACES_PASS } from '../../diagnostic/stage/passLabels.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND, dispatchedEntries } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { backendOf, camera, disposeQuadRun, quadScene } from '../backend/testScenes.fixture.ts'
import type { Engine } from '../../session/engine/types.ts'
import type { PageMesh } from '../../geometry/pages/pageMesh.ts'

const FEEDBACK_TARGET = 'Trillion3D texture feedback target'
type Gpu = ReturnType<typeof fakeDevice>

async function opened(textured: boolean) {
  installGpuGlobals()
  const gpu = fakeDevice(BACKEND)
  const fixture = quadScene()
  // The pages read their material when the backend is made.
  if (textured)
    (fixture.source.children[0] as PageMesh).material = G.standardSurface({
      map: G.dataTexture(new Uint8Array(16).fill(255), 2, 2),
    })
  const backend = backendOf({
    ...fixture,
    gpuDevice: gpu.device,
  })
  await backend.prepare()
  await drawn(backend)
  return { gpu, fixture, backend: backend as Engine }
}

async function drawn(backend: Pick<Engine, 'render' | 'flush'>) {
  backend.render(camera())
  await backend.flush()
}

/** The feedback each image's resolve wrote: the targets its surfaces pass clears, whether its
 *  shade pipelines store the request (`FEEDBACK`), and whether the reduction ran. */
function feedbackOf(gpu: Gpu) {
  const surfaces = gpu.passes.filter((pass) => pass.label === MATERIAL_SURFACES_PASS)
  const shade = gpu.computePipelines.filter((desc) =>
    desc.compute.entryPoint?.startsWith('shade_cs'),
  )
  return {
    targets: gpu.textures.filter((texture) => texture.label === FEEDBACK_TARGET),
    lastPass: surfaces.at(-1)?.formats,
    shade: shade.map((desc) => ({
      entry: desc.compute.entryPoint,
      feedback: desc.compute.constants?.FEEDBACK === 1,
    })),
    reduced: dispatchedEntries(gpu.dispatches).includes('reduce'),
  }
}

test('a scene that wears no texture makes no feedback target, reduces nothing, and its resolve writes four surfaces', async () => {
  const { gpu, fixture, backend } = await opened(false)
  try {
    const seen = feedbackOf(gpu)
    assert.deepEqual(seen.targets, [], 'no target is ever made')
    assert.deepEqual(seen.lastPass?.length, 4)
    assert.ok(seen.shade.length > 0)
    for (const pipeline of seen.shade)
      assert.deepEqual(pipeline, { entry: 'shade_cs', feedback: false })
    assert.equal(seen.reduced, false, 'no reduction is encoded')
  } finally {
    disposeQuadRun(backend, fixture)
  }
})

test('a textured scene keeps the target at the size of the others, writes it and reduces it', async () => {
  const { gpu, fixture, backend } = await opened(true)
  try {
    const seen = feedbackOf(gpu)
    assert.deepEqual(
      seen.targets.map((t) => [t.width, t.height, gpu.destroyed.includes(t)]),
      [[32, 32, false]],
    )
    assert.equal(seen.lastPass?.at(4), 'r32uint')
    for (const pipeline of seen.shade)
      assert.deepEqual(pipeline, { entry: 'shade_cs', feedback: true })
    assert.equal(seen.reduced, true)
  } finally {
    disposeQuadRun(backend, fixture)
  }
})

test('a texture that comes after open brings the target in place, the other targets kept', async () => {
  const { gpu, fixture, backend } = await opened(false)
  const hdr = () => gpu.textures.filter(({ label }) => label === 'Trillion3D HDR lighting')
  try {
    const before = hdr()
    const map = G.dataTexture(new Uint8Array(64), 4, 4)
    await backend.appendTexture(map, 'color')
    // The image asks the variant that writes the feedback; the one in place draws meanwhile.
    await drawn(backend)
    assert.deepEqual(feedbackOf(gpu).targets, [])
    assert.equal(feedbackOf(gpu).lastPass?.length, 4)
    // Compiled, it is installed at the next image's entry, with the target it writes.
    await new Promise((settle) => setTimeout(settle))
    await drawn(backend)
    const seen = feedbackOf(gpu)
    assert.deepEqual(
      seen.targets.map((t) => [t.width, t.height, gpu.destroyed.includes(t)]),
      [[32, 32, false]],
    )
    assert.equal(seen.lastPass?.at(4), 'r32uint')
    assert.deepEqual(hdr(), before, 'no target remade: the frame set stays in place')
    assert.equal(
      before.some((target) => gpu.destroyed.includes(target)),
      false,
    )
    assert.ok(seen.shade.some((pipeline) => pipeline.entry === 'shade_cs' && pipeline.feedback))
  } finally {
    disposeQuadRun(backend, fixture)
  }
})
