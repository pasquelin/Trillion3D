import { followHostTexture } from '../../../host/textureImport.ts';
import { pictureFits } from '../../tile/live.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { shadowsFollowSurfaces } from '../prepare/lightResources.ts';
import { blendMoves, type AlphaChange } from '../../../placement/backendSceneUpdates.ts';
import type { HostMaterials } from '../../../host/resources.ts';
import { surfaceOf } from '../../../page/surface.ts';

/**
 * Opaque and masked clusters are drawn by the same visibility passes, told apart by the flag and
 * cutoff the row writer rereads off the surface (`../../row/pageRowMaterial.ts`), a resolve class
 * the census missed compiling at its first draw (`../../core/materialPasses.ts`): a material moves
 * between them in place. Blended clusters are laid out at open — after the opaque ones in the
 * cluster catalogue, with no geometry page, in the transparent table and its forward copies — and
 * no cluster enters or leaves them inside the session, nor takes another surface (`meshes`, #847).
 */
export const webgpuMaterialClassRefusal = (alpha: AlphaChange) =>
  blendMoves(alpha) || (alpha.meshes && alpha.to === 'blend')
    ? 'its blended clusters are laid out in their forward pass when the session opens'
    : undefined;

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
 * over their rows are drawn again.
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
  const textures = rt.vis.textures;
  if (!textures) return true;
  return [textures.color, textures.data].every((atlas) =>
    atlas.textures.every((entry) => {
      if (entry.source.kind === 'host') followHostTexture(entry.source.map);
      return pictureFits(entry);
    }),
  );
}

/** The records of `alpha.meshes` point to the surface they wear now (`wearSurface`, #847); false
 *  when rows draw none of them, or one is drawn forward, off the surface its copy took at open. */
function wearWebgpuSurface(rt: WebgpuPagesRuntime, { meshes, surfaces }: AlphaChange) {
  const declaration = surfaces[0] as HostMaterials;
  const worn = rt.setup.allPages.filter(
    (rec) => rec.sourceMesh && meshes!.includes(rec.sourceMesh),
  );
  if (!worn.length || worn.some((rec) => rec.transparent)) return false;
  for (const rec of worn) {
    rec.declaration = declaration;
    rec.material = surfaceOf(declaration);
  }
  return true;
}

/** What the session takes of a material change in place (`BackendSceneUpdates`). */
export const webgpuMaterialUpdates = (rt: WebgpuPagesRuntime) => ({
  refreshMaterials: (values?: boolean, alpha?: AlphaChange) =>
    refreshWebgpuMaterials(rt, values, alpha),
  materialClassRefusal: webgpuMaterialClassRefusal,
  wearSurface: (alpha: AlphaChange) => wearWebgpuSurface(rt, alpha),
});
