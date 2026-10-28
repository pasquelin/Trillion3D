import test from 'node:test'
import assert from 'node:assert/strict'
import { webgpuPagesEngine } from '../backend/pages.ts'
import { collectClusterPages } from '../../geometry/selection/collect.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { quadScene, camera } from '../backend/testScenes.fixture.ts'
import {
  assertOccluderImage,
  occluderScene,
  preparedOccluderRun,
} from '../backend/testOccluder.fixture.ts'
import type { Engine } from '../../session/engine/types.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { DEFAULT_SCOPE } from '../../../../sdk-core/src/contracts/base.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import { graphDraws } from '../../geometry/selection/drawSource.ts'
import { createTextureCaches } from '../../materials/texture/textureCaches.ts'
import { createPageCache } from '../../geometry/streaming/pageCache.ts'
import { drawnQuad } from '../backend/drawnQuad.fixture.ts'
import { renderWebgpuPages } from './render.ts'
import { flushWebgpuPages } from './flush.ts'
import { builtPrime } from './primeBuilt.ts'
import { primeOf } from './primeState.ts'
import { farFieldOf } from './primeFarField.ts'
import { previousPyramid, pyramidSources } from './pyramidSources.ts'
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import type { EngineContext } from '../../session/engine/types.ts'

test('webgpu Hi-Z remaining pages stay a subset of the CPU selection oracle', async () => {
  installGpuGlobals()
  const { device } = fakeDevice(BACKEND)
  const scene = occluderScene()
  const { source, indices, associations, geometry, material } = scene
  // `occluderScene` builds `metadata` with only `errorModel`/`clusterStrategy`/`primitives`: the
  // rest of `ClusterManifest` is never read past `primitives`, so it is filled with placeholders.
  const metadata: ClusterManifest = {
    formatVersion: 0,
    status: 'ready',
    key: 'test-occluder',
    scope: DEFAULT_SCOPE,
    sourceTriangles: 0,
    selectedTriangles: 0,
    selectedNodes: 0,
    totalNodes: 0,
    ...scene.metadata,
  }
  const viewport: [number, number] = [32, 32]
  const collected = collectClusterPages(source, graphDraws(source, associations), metadata, indices)
  const run = await preparedOccluderRun(scene, metadata, collected.roots, device, viewport)
  const { cam, cpu } = run,
    backend = run.backend as Engine
  backend.render(cam)
  await backend.flush()
  backend.render(cam)
  const selected = cpu.shown.map((page) => page.url).sort()
  assert.deepEqual(backend.selectedPageIds().sort(), selected)
  assert.deepEqual(selected, ['back', 'front'])
  // Hi-Z drops the occluded page from the image: only the front page's identifiers survive.
  assertOccluderImage(backend, cpu.shown, collected.roots, cam, viewport)
  // The GPU counts its cut where the verdict is given, before occlusion (#1483): what Hi-Z drops
  // is read from the image above, never from a CPU sum of the drawn triangles.
  assert.equal(backend.metrics().submittedTriangles, backend.metrics().selectedTriangles)
  backend.dispose()
  geometry.dispose()
  material.dispose()
})

test("a visibility pass the device fails is the image's failure, said once: no other draw path", async () => {
  installGpuGlobals()
  const { device } = fakeDevice({ ...BACKEND, failVisPass: true })
  const { source, metadata, indices, associations, geometry, material } = quadScene()
  const events: Array<{ phase: string; context: Record<string, unknown> }> = []
  const backend = webgpuPagesEngine({
    textureCaches: createTextureCaches(createPageCache()),
    source,
    metadata,
    indices,
    draws: graphDraws(source, associations),
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
    onDiagnostic: (event) => events.push(event),
  }) as Engine
  await backend.prepare()
  assert.throws(() => backend.render(camera()), /VIS_FAIL/)
  // A traced failure reaches the observer from the diagnostic queue, a task later.
  await new Promise((resolve) => setTimeout(resolve, 0))
  const failures = events.filter((event) => event.phase === 'visibility-render-failed')
  assert.equal(failures.length, 1)
  assert.equal(typeof failures[0].context.error, 'string')
  backend.dispose()
  geometry.dispose()
  material.dispose()
})

/** What the image just drawn built: the number advances once the image's passes have encoded, and what is built for an image is read at its own number. */
const builtOfLastImage = (rt: WebgpuPagesRuntime) => {
  rt.run.frame--
  try {
    return builtPrime(rt)
  } finally {
    rt.run.frame++
  }
}

/** The quad drawn twice with the primed pyramid's settings `options`, its mesh a far-field object
 *  when `farField`; one more image, its cut's uniforms and what the primed draw's cut was given
 *  recorded. */
async function primed(options: Partial<EngineContext>, farField = false) {
  const scene = quadScene()
  ;(scene.source.children[0] as Mesh).farField = farField
  const drawn = await drawnQuad(options, scene)
  const cuts: Record<string, unknown>[] = []
  const prime = primeOf(drawn.rt)
  const dispatch = prime?.cut?.dispatch
  if (prime?.cut && dispatch)
    prime.cut.dispatch = (uniforms, encoder) => (
      cuts.push({ ...uniforms }),
      dispatch(uniforms, encoder)
    )
  renderWebgpuPages(drawn.rt, camera())
  await flushWebgpuPages(drawn.rt)
  const labelled = (label: string) =>
    drawn.gpu.textures.filter((texture) => texture.label === label)
  return { ...drawn, cuts, labelled, uniforms: drawn.rt.run.selectionUniforms }
}

test('a view primes nothing by default: no target, no kernel, no draw, the cut tests the previous image’s pyramid', async () => {
  const { rt, gpu, labelled, uniforms } = await primed({})
  assert.equal(labelled('Trillion3D primed depth').length, 0)
  assert.ok(!gpu.computePipelines.some((p) => (p as { label?: string }).label?.includes('primed')))
  assert.equal(builtOfLastImage(rt), undefined)
  assert.deepEqual(Array.from(uniforms.prevSize!), [32, 32], 'the previous image’s size')
})

test('a primed pyramid is built before the cut’s main pass: a depth of the image’s size shifted right by one more than the bias, the image’s matrix, the cut in two passes', async () => {
  for (const [bias, side] of [
    [2, 4],
    [0, 16],
    [30, 1],
  ] as const) {
    const { rt, labelled, uniforms } = await primed({
      hizPrime: 'always',
      hizPrimeSizeBias: bias,
      hizPrimeFarFieldOnly: false,
    })
    const [depth] = labelled('Trillion3D primed depth')
    assert.deepEqual([depth.width, depth.height], [side, side], `bias ${bias}`)
    const built = builtOfLastImage(rt)!
    assert.ok(built && built.frame === rt.run.frame - 1, 'built for this image')
    assert.deepEqual(built.size, [side, side])
    // The cut tests it as the pyramid of the image before, at the matrix and the depth map of this
    // image — drawn from this very view —, in the pixels the primed draw has.
    assert.equal((uniforms.occlusion ?? 0) & 1, 1, 'in two passes')
    assert.deepEqual(Array.from(uniforms.prevSize!), [side, side])
    assert.deepEqual(Array.from(uniforms.prevViewProj!), Array.from(uniforms.viewProj))
    assert.deepEqual(Array.from(uniforms.prevDepthMap!), Array.from(uniforms.depthMap))
    // The tessellation's patches read the same pyramid, not the image before's.
    rt.run.frame--
    assert.equal(previousPyramid(rt)?.view, built.view)
    rt.run.frame++
  }
})

test('the primed draw is the main view’s cut in one pass with its pixel error times the multiplier, its culls and its scale, the depth pushed away by the bias', async () => {
  const { rt, gpu, cuts, uniforms } = await primed({
    hizPrime: 'always',
    hizPrimeFarFieldOnly: false,
    hizPrimeErrorScale: 8,
    hizPrimeDepthBias: 3,
    cutViewDistanceScale: 0.5,
    cutFrustumCulling: false,
  })
  assert.equal(cuts.length, 1, 'one cut for the image')
  const [cut] = cuts as {
    occlusion: number
    pixelError: number
    cullOff: number
    viewDistanceScale: number
  }[]
  assert.equal(cut.occlusion, 0, 'one pass: nothing is tested against a pyramid')
  assert.equal(cut.pixelError, uniforms.pixelError * 8)
  assert.equal(cut.cullOff, uniforms.cullOff)
  assert.equal(cut.viewDistanceScale, 0.5)
  // The push of the pyramid's level 0: the near and far planes, a perspective's weight, the bias.
  const push = gpu.writes
    .filter(({ buffer }) => buffer.label === 'Trillion3D Hi-Z primed push')
    .at(-1)!
  const [near, far, perspective, bias] = new Float32Array(
    push.data.buffer.slice(push.data.byteOffset, push.data.byteOffset + 16),
  )
  assert.deepEqual([near, far, perspective, bias], [0.1, 100, 1, 3].map(Math.fround))
  assert.equal(Math.fround(rt.run.gate.cam.near), near)
})

test('a primed draw of the far-field objects alone is made only while one is flagged', async () => {
  // No placement flagged: nothing is made, drawn or bound; flagged, the view primes.
  const none = await primed({ hizPrime: 'always' })
  assert.equal(none.labelled('Trillion3D primed depth').length, 0)
  assert.equal(builtOfLastImage(none.rt), undefined)
  assert.equal(farFieldOf(none.rt).count, 0)
  const flagged = await primed({ hizPrime: 'always' }, true)
  assert.equal(flagged.labelled('Trillion3D primed depth').length, 1)
  assert.ok(builtOfLastImage(flagged.rt))
  const far = farFieldOf(flagged.rt)
  assert.equal(far.count, 1)
  // The cut leaves out the placements that are not far-field ones: its one placement is kept.
  assert.deepEqual(Array.from(far.bits!), [0])
  assert.deepEqual(Array.from(flagged.cuts[0].filter as Uint32Array), [0])
})

test('the primed pyramid stands in only while the view has none of the image before when the setting says so', async () => {
  const { rt } = await primed({ hizPrime: 'whenMissing', hizPrimeFarFieldOnly: false })
  assert.equal(builtOfLastImage(rt), undefined, 'a pyramid stands: nothing is primed')
  // A view without one — its first image, a resize — primes.
  pyramidSources.delete(rt.views.active)
  renderWebgpuPages(rt, camera())
  await flushWebgpuPages(rt)
  assert.ok(builtOfLastImage(rt), 'no pyramid of the image before: primed')
  // It stands again once that image built its own.
  renderWebgpuPages(rt, camera())
  await flushWebgpuPages(rt)
  assert.equal(builtOfLastImage(rt), undefined)
})

test('a primed draw that fails is said and the image is cut without it', async () => {
  const { rt, events } = await primed({ hizPrime: 'always', hizPrimeFarFieldOnly: false })
  const prime = primeOf(rt)!
  prime.cut!.dispatch = () => {
    throw new Error('PRIME_LOST')
  }
  renderWebgpuPages(rt, camera())
  await flushWebgpuPages(rt)
  assert.equal(builtOfLastImage(rt), undefined)
  assert.ok(events.some((event) => event.phase === 'hiz-prime-failed'))
  assert.equal((rt.run.selectionUniforms.occlusion ?? 0) & 1, 1, 'the previous image’s pyramid')
})
