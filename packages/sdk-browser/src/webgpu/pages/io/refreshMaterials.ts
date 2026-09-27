import { followHostTexture } from '../../../host/textureImport.ts';
import { pictureFits } from '../../tile/live.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { shadowsFollowSurfaces } from '../prepare/lightResources.ts';
import {
  blendMoves,
  isAssignment,
  type AlphaChange,
  type SurfaceAssignment,
} from '../../../placement/backendSceneUpdates.ts';
import type { HostMaterials } from '../../../host/resources.ts';
import {
  recordsOfMeshes,
  surfaceOf,
  unpagedRefusal,
  wearDeclaration,
} from '../../../page/surface.ts';
import type { PageRec } from '../../../page/selection/selection.ts';

/**
 * Opaque and masked clusters are drawn by the same visibility passes, told apart by the flag and
 * cutoff the row writer rereads off the surface (`../../row/pageRowMaterial.ts`), a resolve class
 * the census missed compiling at its first draw (`../../core/materialPasses.ts`): a material moves
 * between them in place. Blended clusters are laid out at open — after the opaque ones in the
 * cluster catalogue, with no geometry page, in the transparent table and its forward copies — and
 * no cluster enters or leaves them inside the session, nor takes another surface (#847).
 */
export const webgpuMaterialClassRefusal = (alpha: AlphaChange, pages: readonly PageRec[]) =>
  unpagedRefusal(pages, alpha) ||
  ((isAssignment(alpha) ? assignsBlended(alpha, pages) : blendMoves(alpha))
    ? 'its blended clusters are laid out in their forward pass when the session opens'
    : undefined);

/** An assignment into or out of blended, or onto a drawable whose clusters are drawn blended
 *  whatever their surface (`clustered-blend`). */
const assignsBlended = (assignment: SurfaceAssignment, pages: readonly PageRec[]) =>
  assignment.from === 'blend' ||
  assignment.to === 'blend' ||
  recordsOfMeshes(pages, assignment.meshes).some((rec) => rec.transparent);

/**
 * Host surfaces rewritten in place (#335). When their values moved, every row is written again at
 * the next frame, and the writer rereads each surface whose version moved
 * (`row/pageRowConstants.ts`); only values and pictures changed, so no resolve class did. When
 * only their textures moved (`values` false) — a video's frame, a canvas redrawn, a sampling —, no
 * row reads them: the render follows the headers and copies a moved picture into the pool itself
 * (`../render/render.ts`, `../../tile/live.ts`, #362), which releases a held image, and the row
 * table is left as it is. A picture whose size changed cannot be copied: its tiles were laid out
 * at the old one, and false asks the owner for a new session. Surfaces whose alpha moved (`alpha`)
 * — between opaque and masked, or to another cutoff — cut their shadow otherwise: the shadow pages
 * over their rows are drawn again. Once a light casts (its shadow atlas made), that image differs from the one
 * a session opened on the new cutoff draws, by a few shadowed pixels once temporal antialiasing
 * settles (#572): false asks the owner for a new session there too.
 */
export function refreshWebgpuMaterials(rt: WebgpuPagesRuntime, values = true, alpha?: AlphaChange) {
  if (alpha) {
    const surfaces = alpha.surfaces.map((surface) => surfaceOf(surface as HostMaterials));
    shadowsFollowSurfaces(rt.lights, rt.layout.rows, new Set(surfaces));
  }
  if (values) {
    rt.layout.rows.tableEpoch++;
    // The scene revision moved: the next image writes the transparent records again, once
    // (`../render/render.ts`, `refreshBlendScene`), each off its refreshed surface.
    rt.run.gate.sceneMoved();
  }
  // The atlas is made at open whether or not a light is declared: a light in the store casts.
  const exact = !alpha || !rt.lights.store.count || !rt.lights.shadows;
  const textures = rt.vis.textures;
  if (!textures) return exact;
  const fit = [textures.color, textures.data].every((atlas) =>
    atlas.textures.every((entry) => {
      if (entry.source.kind === 'host') followHostTexture(entry.source.map);
      return pictureFits(entry);
    }),
  );
  return exact && fit;
}

/** The records of the assigned meshes point to the surface each wears now (`wearSurface`,
 *  #847), its variant for their geometry: a vertex-coloured one keeps its colours. */
export function wearWebgpuSurface(rt: WebgpuPagesRuntime, { meshes }: SurfaceAssignment) {
  for (const rec of recordsOfMeshes(rt.setup.allPages, meshes))
    wearDeclaration(rec, meshes.get(rec.sourceMesh!) as HostMaterials);
}
