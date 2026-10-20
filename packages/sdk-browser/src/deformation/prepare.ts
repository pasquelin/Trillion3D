import { createSessionDeformation, deformsAny } from './session.ts'
import {
  prepareWebgpuGeometry,
  type VertexPoolGrowth,
} from '../geometry/pages/pool/geometryPrepare.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { families } from '../session/host/families.ts'
import { assignDeformationOutputs, followPooledBlocks } from './outputs.ts'
import { refreshBlendScene } from '../blend/sceneRefresh.ts'

/**
 * A growth of the float pool (`prepareWebgpuGeometry`'s `grown`): its wider buffers and the
 * blocks' table re-placed after them replace the runtime's; the rows and spans that read the
 * moved deformation block are pointed at it again (`followPooledBlocks`), and so are the
 * transparent records, which name a placement's record (`refreshBlendScene`).
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

/** The stage's compute, made once for a session whose code is loaded: the code is loaded only for
 *  work to deform (`deformsAny`). */
export async function prepareDeformationCompute(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis } = rt
  if (vis.deformationCode)
    vis.deformationCompute ??= await vis.deformationCode.createDeformationCompute(device)
}

/**
 * One setup for the deformation of every placement, sharing the vertex pool. A session that
 * deforms — a root with a record, a page with deformed results — first awaits the family's code
 * (`deformationCode.ts`), as its scene's other resources, before any frame; one that does not
 * loads none of it, and its pool holds no block.
 */
export async function prepareDeformationGeometry(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis, layout, setup } = rt
  vis.pooledDeformation?.table.destroy()
  vis.pooledDeformation = undefined
  vis.geometryBlocks.clear()
  vis.deformationCode = undefined // a refused import below leaves no earlier prepare's code
  vis.deformationCompute = undefined
  // The results of every deformed page of every placement, in the float pool's tail.
  setup.deformationBlocks.length = 0
  setup.deformationBlocks.push(...assignDeformationOutputs(layout.selectionRoots))
  vis.deformation = createSessionDeformation(layout.selectionRoots)
  const code = await loadDeformationCode(vis, deformsAny(layout.selectionRoots))
  Object.assign(
    vis,
    prepareWebgpuGeometry(
      device,
      setup.allPages,
      vis.geometryBlocks,
      vis.deformation,
      (growth) => followPoolGrowth(rt, device, growth),
      code?.pooledDeformationRows,
      setup.deformationBlocks,
    ),
  )
}
