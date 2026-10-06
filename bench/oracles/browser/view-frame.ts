// Batch F oracles, frame side: `packages/sdk-browser/src/webgpu/pages/render/encodeVis.ts:93-98`
// from before batch F, copied as-is; the instance displacement rewritten from its contract after #1226/#1235 moved poses to the roots.
import { Matrix4 } from '../../../packages/sdk-core/src/world/math/matrix4.ts'
import type { SurfaceBuffer } from '../../../packages/sdk-browser/src/scene/surfaceBuffer.ts'

/** A root as the instance oracle reads it: its world, and the pages it places. */
interface InstanceRoot {
  world: Matrix4
  pages: { mesh?: { matrix: Matrix4 } }[]
}

/** Colour attachments, rebuilt per frame before batch F. */
export function referenceAttachments(surfaces: SurfaceBuffer) {
  return surfaces.views().map((view) => ({
    view,
    loadOp: 'clear' as const,
    storeOp: 'store' as const,
    clearValue: [0, 0, 0, 0],
  }))
}

/**
 * Instance displacement since #1226/#1235: each root's world becomes `transform · base world`, and
 * the host mesh of each page it places wears that world — a page carries no pose of its own
 * (`instancePose.ts`). `transform` is the engine's sixteen doubles.
 */
export function referenceUpdateInstance(
  instance: { roots: InstanceRoot[] },
  baseRoots: { world: Matrix4 }[],
  transform: Float64Array,
) {
  const placement = new Matrix4().fromArray(transform)
  for (let i = 0; i < instance.roots.length; i++) {
    const root = instance.roots[i]
    root.world.copy(placement).multiply(baseRoots[i].world)
    for (const page of root.pages) if (page.mesh) page.mesh.matrix.copy(root.world)
  }
}
