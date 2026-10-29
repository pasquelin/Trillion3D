import { invertMatrix4 } from '../../../../../math/src/matrix/matrix4Inverse.ts'
import type { FrustumGrid } from './frustumGridBuild.ts'
import { packGridParams } from './gridPack.ts'
import type { OrthoGrid } from './orthoGridBuild.ts'

/** The two corners of a box of centre and half sizes. */
const cornersOf = (box: OrthoGrid['bounds']) => ({
  min: box.origin.map((o, i) => o - box.extent[i]) as unknown as [number, number, number],
  max: box.origin.map((o, i) => o + box.extent[i]) as unknown as [number, number, number],
})

/** The grids' parameters (`VgGridParams`) the passes that read the grids bind: each grid with its bounds and resolution, a grid not built having none. */
export function gridParamsOf(
  ortho: OrthoGrid | undefined,
  frustum: FrustumGrid | undefined,
): ArrayBuffer {
  const worldToView = new Float64Array(16)
  if (frustum) invertMatrix4(worldToView, frustum.viewToWorld)
  return packGridParams({
    ortho: ortho && { ...cornersOf(ortho.bounds), resolution: ortho.resolution },
    indirection: !!ortho?.indirection,
    frustum: frustum && { ...cornersOf(frustum.bounds), resolution: frustum.resolution },
    worldToView,
    nearDepth: frustum?.near ?? 0,
    farDepth: frustum?.far ?? 0,
    tanHalfFov: frustum?.tanHalfFov ?? 0,
    cellVoxels: ortho?.cellVoxels ?? 1,
  })
}
