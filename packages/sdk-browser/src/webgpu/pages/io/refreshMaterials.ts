import { followHostTexture } from '../../../host/textureImport.ts';
import { pictureFits } from '../../tile/live.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/**
 * Host surfaces rewritten in place (#335): every row is written again at the next frame, and the
 * writer rereads each surface whose version moved (`row/pageRowConstants.ts`); only values and
 * pictures changed, so no resolve class did. A moved picture is copied into the pool at the next
 * render (`../../tile/live.ts`, #362) — unless its size changed: its tiles were laid out at the
 * old one, and false asks the owner for a new session.
 */
export function refreshWebgpuMaterials(rt: WebgpuPagesRuntime) {
  rt.layout.rows.tableEpoch++;
  rt.run.gate.sceneMoved();
  const textures = rt.vis.textures;
  if (!textures) return true;
  return [textures.color, textures.data].every((atlas) =>
    atlas.textures.every((entry) => {
      if (entry.source.kind === 'host') followHostTexture(entry.source.map);
      return pictureFits(entry);
    }),
  );
}
