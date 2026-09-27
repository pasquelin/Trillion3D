import { followHostTexture } from '../../../host/textureImport.ts';
import { pictureFits } from '../../tile/live.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { AlphaMode } from '../../../../../sdk-core/src/contracts/material.ts';
import { shadowsFollowTextures } from '../prepare/lightResources.ts';

/**
 * Opaque and masked clusters are drawn by the same visibility passes, told apart by the flag and
 * cutoff the row writer rereads off the surface (`../../row/pageRowMaterial.ts`), a resolve class
 * the census missed compiling at its first draw (`../../core/materialPasses.ts`): a material moves
 * between them in place. Blended clusters are laid out at open — after the opaque ones in the
 * cluster catalogue, with no geometry page, in the transparent table and its forward copies — and
 * no cluster enters or leaves them inside the session.
 */
export const webgpuMaterialClassRefusal = (from: AlphaMode, to: AlphaMode) =>
  from === 'blend' || to === 'blend'
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
 * at the old one, and false asks the owner for a new session. A material moved between opaque and
 * masked (`reclassed`) now cuts its shadow, or no longer does: every shadow page is drawn again.
 */
export function refreshWebgpuMaterials(rt: WebgpuPagesRuntime, values = true, reclassed = false) {
  if (reclassed) shadowsFollowTextures(rt.lights, rt.layout.rows, -1);
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
