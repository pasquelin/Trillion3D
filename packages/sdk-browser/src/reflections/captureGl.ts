import { WebglReflectionPyramid } from './pyramidGl.ts'
import { LTC_UNIT } from '../webgl/cluster/rectGlsl.ts'
import { surfaceOf } from '../page/surface.ts'
import { mirrorRange, coatedScreenReflects } from './eligible.ts'
import type { HostMaterials } from '../host/resources.ts'
import type { ClusterDraw } from '../cluster/batchMesh.ts'
import { WebglClusterBackdrop } from '../webgl/cluster/backdrop.ts'

/** Freeze a source without recursive mirrors or camera fog, restoring the output before
 * the final material passes. Disabled sources release their storage immediately. */
export function capture(
  gl: WebGL2RenderingContext,
  target: WebglClusterBackdrop,
  active: boolean,
  capture: WebGLUniformLocation | null,
  draw: () => void,
) {
  gl.uniform1i(capture, active ? 1 : 0)
  if (active) {
    target.begin(null)
    draw()
    target.end()
    target.bind()
  } else target.dispose()
  gl.uniform1i(capture, 0)
}

export const target = (gl: WebGL2RenderingContext) =>
  new WebglClusterBackdrop(gl, [LTC_UNIT + 1, LTC_UNIT + 2], new WebglReflectionPyramid(gl))
/** A screen-traced receiver: a matte-only view allocates no capture and runs no pass. */
const reflecting = (mesh: { material: HostMaterials }) =>
  coatedScreenReflects(surfaceOf(mesh.material))
/** A mirror-range mesh: what the reduced resolve pass redraws, the rough-only ones staying out. */
const atMirrorRange = (mesh: { material: HostMaterials }) => mirrorRange(surfaceOf(mesh.material))
export const receivers = (lists: readonly (readonly { material: HostMaterials }[])[]) =>
  lists.some((list) => list.some(reflecting))
export const mirrorMeshes = (lists: readonly (readonly ClusterDraw[])[]): ClusterDraw[] =>
  lists.flatMap((list) => list.filter(atMirrorRange))
