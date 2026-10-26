import { pictureFits } from '../../materials/virtual/live.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import {
  blendMoves,
  isAssignment,
  type AlphaChange,
  type SurfaceAssignment,
} from '../../placement/engineSceneUpdates.ts'
import { recordsOfMeshes, wearDeclaration, type PageSurface } from '../../geometry/pages/surface.ts'
import { shadowsFollowSurfaces } from '../../lighting/shadows/casters/followChanges.ts'
import type { PageRec } from '../../geometry/selection/types.ts'
import type { PageMaterials } from '../../geometry/pages/pageMesh.ts'

/**
 * Opaque and masked clusters are drawn by the same visibility passes, told apart by the flag and
 * cutoff the cluster records' writer rereads off the surface (`../../geometry/clusters/infoWrite.ts`), a resolve class a
 * material changed into compiled before the image that draws it (`../loop/framePipelines.ts`):
 * a material moves between them in place. Blended clusters are laid out at open — after the opaque
 * ones in the cluster catalogue, in the transparent table and its forward copies — and no cluster
 * enters or leaves them inside the session, nor takes another surface.
 */
export const webgpuMaterialClassRefusal = (alpha: AlphaChange, pages: readonly PageRec[]) =>
  (isAssignment(alpha) ? assignsBlended(alpha, pages) : blendMoves(alpha))
    ? 'its blended clusters are laid out in their forward pass when the session opens'
    : undefined

/** An assignment into or out of blended, or onto a drawable whose clusters are drawn blended
 *  whatever their surface (`clustered-blend`). */
const assignsBlended = (assignment: SurfaceAssignment, pages: readonly PageRec[]) =>
  assignment.from === 'blend' ||
  assignment.to === 'blend' ||
  recordsOfMeshes(pages, assignment.meshes).some((rec) => rec.transparent)

/**
 * Surface records rewritten in place. When their values moved, the next frame writes their records
 * in the material table again (`follow`, `../../materials/table/materialTable.ts`, from the render's
 * scene inputs, `../render/render.ts`) — one record a surface, no item —, and the clusters' records
 * and the items only where what they read beside the record moved: a flag, a resolve class, which is
 * then compiled before the image that draws it (`shadeCensus`). When only their textures moved
 * (`values` false) — a video's frame, a canvas redrawn, a sampling —, no record reads them: the
 * render follows the headers and copies a moved picture into the pool itself
 * (`../render/render.ts`, `../../materials/virtual/live.ts`), which releases a held image. A picture whose size
 * changed cannot be copied: its tiles were laid out at the old one, and false tells the owner, which
 * says it by name. Surfaces whose alpha moved (`alpha`) — between opaque and masked, or to another
 * cutoff — cut their shadow otherwise. Their clusters' records, or those of the meshes given
 * another surface (an assignment), are written again at the next frame: a record names its surface.
 */
export function refreshWebgpuMaterials(rt: WebgpuPagesRuntime, values = true, alpha?: AlphaChange) {
  if (alpha) {
    // The shadow pages over the clusters of the surfaces whose alpha moved are drawn again.
    shadowsFollowSurfaces(rt, new Set(alpha.surfaces as readonly PageSurface[]))
    // Every resident cluster's record is written again: it names its surface.
    rt.layout.clusters.infoEpoch++
    rt.vis.shadeCensus?.moved()
  }
  // The scene revision moved: the next image follows the rewritten surfaces' records.
  if (values) rt.run.gate.movedInPlace()
  const textures = rt.vis.textures
  if (!textures) return true
  return [textures.color, textures.data].every((atlas) =>
    atlas.textures.every((entry) => pictureFits(entry)),
  )
}

/** The records of the assigned meshes point to the surface each wears now (`wearSurface`),
 *  its variant for their geometry: a vertex-coloured one keeps its colours. */
export function wearWebgpuSurface(rt: WebgpuPagesRuntime, { meshes }: SurfaceAssignment) {
  for (const rec of recordsOfMeshes(rt.setup.allPages, meshes))
    wearDeclaration(rec, meshes.get(rec.drawSource!) as PageMaterials)
  rt.vis.shadeCensus?.moved(true)
}
