// S10: the texture feedback — a 4 B/px target, its clear, its writes and the reduction each image —
// is a textured scene's alone. A scene that wears no texture has no tile to ask for: it makes no
// target and draws with the pipelines that write none; a texture that comes later brings the target
// in place, beside the others, which are not remade.
import assert from 'node:assert/strict'
import test from 'node:test'
import * as G from '../../../host/graph/graph.fixture.ts'
import { importHostTexture } from '../../../host/textureImport.ts'
import type { HostTexture } from '../../../host/resources.ts'
import { MATERIAL_SURFACES_PASS } from '../../../stage/passLabels.ts'
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts'
import { camera, disposeQuadRun, quadScene } from '../testScenes.fixture.ts'
import { webgpuPagesBackend } from '../pages.ts'
import type { WebgpuPagesBackend, WebgpuPagesRuntime } from '../runtime.ts'
import { followFeedback } from './feedbackVariant.ts'

const FEEDBACK_TARGET = 'Trillion3D texture feedback target'
type Gpu = ReturnType<typeof mockGpu>

async function opened(textured: boolean) {
  installGpuGlobals()
  const gpu = mockGpu({ compute: true })
  const fixture = quadScene()
  // The pages read their material when the backend is made.
  if (textured)
    (fixture.source.children[0] as G.HostMesh).material = G.standardSurface({
      map: G.dataTexture(new Uint8Array(16).fill(255), 2, 2),
    })
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: gpu.device,
    maxResidentPages: 2,
    viewport: [32, 32],
  })
  await backend.prepare()
  await drawn(backend)
  return { gpu, fixture, backend: backend as WebgpuPagesBackend }
}

async function drawn(backend: { render: WebgpuPagesBackend['render']; flush?: () => unknown }) {
  backend.render(camera())
  await backend.flush?.()
}

/** The feedback each image's resolve wrote: the targets of its surfaces pass, its shade
 *  pipelines' outputs, and whether the reduction ran. */
function feedbackOf(gpu: Gpu) {
  const surfaces = gpu.passes.filter((pass) => pass.label === MATERIAL_SURFACES_PASS)
  const shade = gpu.renderPipelines.filter((desc) =>
    desc.fragment?.entryPoint?.startsWith('shade_fs'),
  )
  return {
    targets: gpu.textures.filter((texture) => texture.label === FEEDBACK_TARGET),
    lastPass: surfaces.at(-1)?.formats,
    shade: shade.map((desc) => ({
      entry: desc.fragment!.entryPoint,
      r32: [...desc.fragment!.targets].some((target) => target?.format === 'r32uint'),
    })),
    reduced: gpu.computes.includes('reduce'),
  }
}

test('a scene that wears no texture makes no feedback target, reduces nothing, and its resolve writes four surfaces', async () => {
  const { gpu, fixture, backend } = await opened(false)
  try {
    const seen = feedbackOf(gpu)
    assert.deepEqual(seen.targets, [], 'no target is ever made')
    assert.deepEqual(seen.lastPass?.length, 4)
    assert.ok(!seen.lastPass?.includes('r32uint'))
    assert.ok(seen.shade.length > 0)
    for (const pipeline of seen.shade)
      assert.deepEqual(pipeline, { entry: 'shade_fsWithoutFeedback', r32: false })
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
      seen.targets.map(({ width, height, destroyed }) => [width, height, destroyed]),
      [[32, 32, false]],
    )
    assert.equal(seen.lastPass?.at(4), 'r32uint')
    for (const pipeline of seen.shade) assert.deepEqual(pipeline, { entry: 'shade_fs', r32: true })
    assert.equal(seen.reduced, true)
  } finally {
    disposeQuadRun(backend, fixture)
  }
})

test('a texture that comes after open brings the target in place, the other targets kept', async () => {
  const { gpu, fixture, backend } = await opened(false)
  const hdr = () => gpu.textures.filter(({ label }) => label === 'Trillion3D HDR lighting')
  try {
    const [before] = hdr()
    const map = importHostTexture(G.dataTexture(new Uint8Array(64), 4, 4) as unknown as HostTexture)
    await backend.appendTexture(map, 'color')
    // The image asks the variant that writes the feedback; the one in place draws meanwhile.
    await drawn(backend)
    assert.deepEqual(feedbackOf(gpu).targets, [])
    assert.ok(!feedbackOf(gpu).lastPass?.includes('r32uint'))
    // Compiled, it is installed at the next image's entry, with the target it writes.
    await new Promise((settle) => setTimeout(settle))
    await drawn(backend)
    const seen = feedbackOf(gpu)
    assert.deepEqual(
      seen.targets.map(({ width, height, destroyed }) => [width, height, destroyed]),
      [[32, 32, false]],
    )
    assert.equal(seen.lastPass?.at(4), 'r32uint')
    assert.deepEqual(hdr(), [before], 'no target remade: the frame set stays in place')
    assert.equal(before.destroyed, false)
    assert.ok(seen.shade.some((pipeline) => pipeline.entry === 'shade_fs' && pipeline.r32))
  } finally {
    disposeQuadRun(backend, fixture)
  }
})

test('a variant replaced before it was installed frees the water pass it made', () => {
  let disposed = 0
  const water = { frame: { dispose: () => void disposed++ } }
  const rt = {
    context: {},
    gpu: {},
    vis: {
      visEnabled: true,
      mapLayer: new Map(),
      dataLayer: new Map(),
      writesFeedback: false,
      writesEmissiveAo: true,
      feedbackAside: { feedback: true, emissiveAo: true, set: { water } },
    },
  } as unknown as WebgpuPagesRuntime
  // The texture left again before the variant that writes its feedback was installed.
  followFeedback(rt, {} as GPUDevice)
  assert.equal(disposed, 1, 'its water pass never drew: it goes')
  assert.equal(rt.vis.feedbackAside, undefined, 'the pipelines in place already fit')
})
