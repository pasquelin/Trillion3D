import { createSessionDeformation } from './session.ts'
import { prepareWebgpuGeometry, type VertexPoolGrowth } from '../webgpu/core/geometryPrepare.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { families } from '../host/families.ts'
import { assignDeformationOutputs, followPooledBlocks } from './outputs.ts'
import { refreshBlendScene } from '../webgpu/blend/resources.ts'

/**
 * A growth of the float pool (`prepareWebgpuGeometry`'s `grown`): its wider buffers and the
 * whole-copy table re-placed after them replace the runtime's; the rows and spans that read the
 * moved deformation block are pointed at it again (`followPooledBlocks`), and so are the
 * transparent records, which name a whole copy's inputs and results and a placement's record
 * (`refreshBlendScene`).
 */
function followPoolGrowth(rt: WebgpuPagesRuntime, device: GPUDevice, growth: VertexPoolGrowth) {
  Object.assign(rt.vis, growth)
  followPooledBlocks(rt)
  refreshBlendScene(rt, device)
  rt.run.gate.resourcesChanged()
}

/** The stage's code, awaited by a session that deforms (`deformationCode.ts`), kept once loaded. */
export async function loadDeformationCode(vis: WebgpuPagesRuntime['vis'], deforms: boolean) {
  if (deforms) vis.deformationCode ??= await families.deformation.load()
  return vis.deformationCode
}

/** The stage's compute, made once for a session whose code is loaded and which has something to
 *  deform: a page's results, a whole copy, or `deforms` (a source about to join). */
export async function prepareDeformationCompute(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  deforms = rt.setup.deformationBlocks.length > 0 || !!rt.vis.wholeDeformation,
) {
  const { vis } = rt
  if (deforms && vis.deformationCode)
    vis.deformationCompute ??= await vis.deformationCode.createDeformationCompute(device)
}

/**
 * One setup for clustered and material-driven whole-copy deformation, sharing the vertex pool. A
 * session that deforms — a root or a whole copy with a record, a page with deformed results —
 * first awaits the family's code (`deformationCode.ts`), as its scene's other resources, before
 * any frame; one that does not loads none of it, and its pool holds no whole copy.
 */
export async function prepareDeformationGeometry(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis, layout, setup, blendState } = rt
  vis.wholeDeformation?.table.destroy()
  vis.wholeDeformation = undefined
  vis.geometryBlocks.clear()
  vis.deformationCode = undefined // a refused import below leaves no earlier prepare's code
  vis.deformationCompute = undefined
  // The results of every deformed page of every placement, in the float pool's tail.
  setup.deformationBlocks.length = 0
  setup.deformationBlocks.push(...assignDeformationOutputs(layout.selectionRoots))
  vis.deformation = createSessionDeformation(
    layout.selectionRoots,
    setup.blendCopies.filter((copy) => !copy.userData.pagedBlend),
  )
  const code = await loadDeformationCode(
    vis,
    vis.deformation.any || setup.deformationBlocks.length > 0,
  )
  Object.assign(
    vis,
    prepareWebgpuGeometry(
      device,
      setup.allPages,
      vis.geometryBlocks,
      vis.deformation,
      blendState.blendGpu,
      (growth) => followPoolGrowth(rt, device, growth),
      code?.wholeDeformationPool,
      setup.deformationBlocks,
    ),
  )
}
