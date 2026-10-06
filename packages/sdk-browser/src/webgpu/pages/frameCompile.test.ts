// No frame compiles a pipeline: on a whole backend, every pipeline is compiled off the
// thread — at preparation, or at the frame entry after what needs it entered the scene, the frame
// held meanwhile. A device whose compiles land a task later counts every synchronous one made while
// an image renders: none, through a material that turns masked, a surface that comes to emit, a
// guide shown.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { camera, disposeQuadRun, quadScene } from './testScenes.fixture.ts'
import { webgpuPagesBackend } from './pages.ts'
import { createGuideSet } from '../../guides/guideSet.ts'
import { families } from '../../host/families.ts'
import { MATERIAL_SURFACES_PASS } from '../../stage/passLabels.ts'
import { gateCompiles } from '../../lighting/deferred/gatedDevice.fixture.ts'

/** The executing device, whose compiles land off the thread a task after they are asked, and which
 *  counts each synchronous compile made inside `frame`. */
function offThreadGpu() {
  const gpu = mockGpu({ compute: true })
  const { compiled } = gateCompiles(gpu.device, { auto: true })
  const counted = {
    inFrame: 0,
    get offThread() {
      return compiled.async
    },
  }
  /** `draw`, run as one image renders. */
  const frame = (draw: () => void) => {
    const before = compiled.sync
    try {
      draw()
    } finally {
      counted.inFrame += compiled.sync - before
    }
  }
  return { gpu, counted, frame }
}

test('no image compiles a pipeline, whatever enters the scene after preparation', async () => {
  installGpuGlobals()
  await families.guides.load()
  const { gpu, counted, frame } = offThreadGpu()
  const fixture = quadScene()
  const material = G.standardSurface({ roughness: 0.5 })
  ;(fixture.source.children[0] as G.HostMesh).material = material
  const guides = createGuideSet()
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: gpu.device,
    maxResidentPages: 2,
    viewport: [32, 32],
    guides,
  })
  const resolves = () => gpu.passes.filter(({ label }) => label === MATERIAL_SURFACES_PASS).length
  /** Renders, then waits for what the frame held on and draws the pose again. */
  const settle = async () => {
    frame(() => backend.render(camera()))
    await backend.flush?.()
  }
  try {
    await backend.prepare()
    const prepared = counted.offThread
    assert.ok(prepared > 0, 'preparation compiles off the thread')
    for (let image = 0; image < 3; image++) await settle()
    assert.ok(resolves() > 0, 'the images were drawn')
    // A material turned masked: a class the census did not have.
    material.alphaTest = 0.5
    material.needsUpdate = true
    backend.refreshMaterials?.(true, { surfaces: [material], from: 'opaque', to: 'mask' })
    await settle()
    // The same surface made to emit: the classes writing the layer.
    ;(material.emissive as G.Color).setRGB(0.5, 0.25, 0)
    material.needsUpdate = true
    backend.refreshMaterials?.(true)
    await settle()
    // A guide shown: its pass.
    guides.lines({ positions: [0, 0, 0, 1, 0, 0] })
    await settle()
    assert.equal(counted.inFrame, 0, 'no image compiled a pipeline')
    const shaded = gpu.renderPipelines.filter(({ fragment }) =>
      fragment?.entryPoint?.startsWith('shade_fs'),
    )
    assert.ok(
      shaded.some(({ fragment }) => fragment!.constants?.EMISSIVE_AO === undefined),
      'the classes writing the layer were compiled',
    )
    assert.ok(
      gpu.renderPipelines.some(({ label }) => label === 'Trillion3D guides'),
      'the guide pass was compiled',
    )
    assert.ok(counted.offThread > prepared, 'what entered the scene compiled off the thread')
  } finally {
    disposeQuadRun(backend, fixture)
  }
})
