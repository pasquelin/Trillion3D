// S8: the emission-and-occlusion layer (8 B/px) is an image's only when one of its surfaces can
// mark a texel of it. Without, the resolve leaves its attachment empty and marks nothing, and the
// readers bind a 1×1 `(0, 0, 0, 1)` they never load. A surface that comes to emit brings the layer
// before the first image that draws it, its classes compiled off the frame meanwhile.
import assert from 'node:assert/strict'
import test from 'node:test'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { MATERIAL_SURFACES_PASS } from '../../diagnostic/stage/passLabels.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { backendOf, camera, disposeQuadRun, quadScene } from '../backend/testScenes.fixture.ts'
import { runtime } from './targets.fixture.ts'
import { frameTargetAllocation } from './targetAllocation.ts'
import { wantsEmissiveAo } from './emissiveAoLayer.ts'
import { surfaceWritten } from '../../geometry/pages/surfaceWrites.ts'
import type { PageMesh } from '../../geometry/pages/pageMesh.ts'

type Gpu = ReturnType<typeof fakeDevice>
const count = (list: string[], item: string) => list.filter((at) => at === item).length

async function opened(emits: boolean) {
  installGpuGlobals()
  const gpu = fakeDevice(BACKEND)
  const fixture = quadScene()
  const material = G.standardSurface({ roughness: 0.5 })
  if (emits) material.emissive = [0.5, 0.25, 0]
  const mesh = fixture.source.children[0] as PageMesh
  mesh.material = material
  const backend = backendOf({
    ...fixture,
    gpuDevice: gpu.device,
  })
  await backend.prepare()
  // The images it takes for the frame targets to settle (made aside, then in place).
  for (let image = 0; image < 3; image++) {
    backend.render(camera())
    await backend.flush()
  }
  return { gpu, fixture, backend, material }
}

/** The live textures labelled `label`. */
const live = (gpu: Gpu, label: string) =>
  gpu.textures.filter((t) => t.label === label && !gpu.destroyed.includes(t))

/** The live surface colours' sizes and layers, the live emission stand-ins, the resolve's
 *  pipelines and its last pass. */
function surfacesOf(gpu: Gpu) {
  const colours = live(gpu, 'Trillion3D surface colours').map(
    ({ width, height, depthOrArrayLayers }) => `${width}×${height}×${depthOrArrayLayers}`,
  )
  const shade = gpu.computePipelines
    .filter(({ compute }) => compute.entryPoint?.startsWith('shade_cs'))
    .map(({ compute }) => ({ constant: compute.constants?.EMISSIVE_AO }))
  const pass = gpu.passes.filter(({ label }) => label === MATERIAL_SURFACES_PASS).at(-1)
  return {
    colours,
    standIns: live(gpu, 'Trillion3D emission stand-in'),
    shade,
    slot: pass?.formats[2],
  }
}

test('an image none of whose surfaces emits or occludes holds a 1×1 stand-in and writes no layer', async () => {
  const { gpu, fixture, backend } = await opened(false)
  try {
    const seen = surfacesOf(gpu)
    // Each frame set: colours of two layers of the frame's size, the third a stand-in.
    assert.ok(seen.colours.length > 0)
    assert.equal(count(seen.colours, '32×32×2'), seen.colours.length)
    assert.equal(seen.standIns.length, seen.colours.length)
    assert.ok(seen.shade.length > 0)
    for (const pipeline of seen.shade) assert.deepEqual(pipeline, { constant: 0 })
    assert.equal(seen.slot, '', 'the attachment is empty')
  } finally {
    disposeQuadRun(backend, fixture)
  }
})

test('an emitting surface keeps the layer, written by the pipelines of before', async () => {
  const { gpu, fixture, backend } = await opened(true)
  try {
    const seen = surfacesOf(gpu)
    assert.equal(seen.standIns.length, 0)
    assert.equal(count(seen.colours, '32×32×3'), seen.colours.length)
    for (const pipeline of seen.shade) assert.deepEqual(pipeline, { constant: undefined })
    assert.equal(seen.slot, 'rgba16float')
  } finally {
    disposeQuadRun(backend, fixture)
  }
})

test('a surface made to emit after open brings the layer before the image that draws it', async () => {
  const { gpu, fixture, backend, material } = await opened(false)
  const hdr = () =>
    gpu.textures.filter((t) => t.label === 'Trillion3D HDR lighting' && !gpu.destroyed.includes(t))
  try {
    const lit = hdr(),
      before = surfacesOf(gpu),
      standIn = before.standIns[0]!
    material.emissive = [0, 0.5, 1]
    surfaceWritten(material)
    backend.refreshMaterials?.(true)
    const resolves = () => gpu.passes.filter(({ label }) => label === MATERIAL_SURFACES_PASS)
    const drawn = resolves().length
    backend.render(camera())
    // The census heard the surface: the image is held while the classes that write the layer
    // compile, off the frame — none is drawn without it, none compiled by the frame.
    assert.equal(resolves().length, drawn, 'held, the previous image shown')
    await backend.flush()
    const seen = surfacesOf(gpu)
    assert.equal(seen.slot, 'rgba16float', 'the first image drawn writes the emission')
    // The drawn view's colours are made again with the layer; those replaced and their stand-in
    // are retired, destroyed once the frame that named them is submitted.
    assert.equal(count(seen.colours, '32×32×3'), 1, 'the drawn view holds the layer')
    assert.equal(count(seen.colours, '32×32×2'), count(before.colours, '32×32×2') - 1)
    assert.equal(seen.standIns.length, before.standIns.length - 1, 'its stand-in retired')
    assert.equal(gpu.destroyed.includes(standIn), true, 'with the frame that replaced it')
    // The classes compiled since write it; the other targets stay in place.
    assert.deepEqual(seen.shade.at(-1), { constant: undefined })
    // The scene's one class shades its bin, now writing the layer, as before it emitted.
    const shaded = gpu.dispatches.filter(({ entryPoint }) => entryPoint?.startsWith('shade_'))
    assert.equal(shaded.at(-1)?.entryPoint, 'shade_cs', 'its bin shaded')
    assert.deepEqual(hdr(), lit, 'no frame target remade')
    backend.dispose()
  } finally {
    disposeQuadRun(backend, fixture)
  }
})

test("the frame's bytes count the layer only where it is made", () => {
  const { rt } = runtime()
  rt.vis.writesEmissiveAo = true
  const full = frameTargetAllocation(rt, {
    width: 64,
    height: 32,
    renderWidth: 64,
    renderHeight: 32,
    apart: false,
  })
  rt.vis.writesEmissiveAo = false
  const size = { width: 64, height: 32, renderWidth: 64, renderHeight: 32, apart: false }
  assert.equal(full - frameTargetAllocation(rt, size), 64 * 32 * 8 - 8)
  const scene = (patch: object) =>
    wantsEmissiveAo({
      context: {},
      blendState: { transmissive: 0 },
      gpu: {},
      vis: { shadeCensus: { emits: false } },
      ...patch,
    } as unknown as Parameters<typeof wantsEmissiveAo>[0])
  assert.equal(scene({}), false)
  assert.equal(scene({ vis: { shadeCensus: { emits: true } } }), true, 'a surface emits')
  assert.equal(scene({ blendState: { transmissive: 1 } }), false, 'no transmissive layer reads it')
})
