import { deformationTextureBytes, geometryDeformationBytes } from './textureBytes.ts';
import { rootOf } from '../page/selection/placements.ts';
import { checkSoftSourceIds } from './wholeInputs.ts';
import { BufferAttribute } from '../../../sdk-core/src/world/buffer/attribute.ts';
import type { BlendCopy } from '../cluster/blendCopyContract.ts';
import type { EngineCamera } from '../camera/world.ts';
import type { ClusterRoot } from '../page/selection/types.ts';
import type { PageRec } from '../page/selection/selection.ts';
import type { HostWorldPlacements } from '../host/world/placements.ts';
import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts';
import { createSessionDeformation } from './session.ts';

/**
 * A WebGL2 session's deformation (#357): the records of its roots (`session.ts`), which the
 * program reads as a texture of their own (`../webgl/cluster/deformation.ts`) — each record named
 * from float zero, so a page mesh carries its record's first float plus one (`wordOf`). Each image
 * (`update`), once its worlds are current, writes the records, sets each deformed root's reach
 * for the cut and counts a new `version` when one moved; `pending` says the next image would
 * write other records, which a held frame would not show.
 */
export function createWebglDeformation(
  roots: readonly ClusterRoot<PageRec>[],
  worlds: Pick<HostWorldPlacements, 'of'>,
  copies: readonly BlendCopy[] = [],
) {
  const session = createSessionDeformation(roots, worlds, copies),
    frame = session.frame,
    source = {
      block: frame.block,
      words: frame.words,
      bases: frame.bases,
      get version() {
        return frame.revision;
      },
    },
    deformedGeometries = new Set<Geometry>();
  for (const root of roots)
    for (const page of root.pages) page.deformRecord = session.wordOfWorld(root.world);
  for (const copy of copies) {
    const ids = copy.deformation?.softSourceIds;
    if (ids && !copy.geometry.attributes.skinIndex) {
      checkSoftSourceIds(
        copy.geometry.attributes.position?.count ?? 0,
        ids,
        copy.deformation?.softVertices,
      );
      const joints = new Float32Array(ids.length * 4),
        weights = new Float32Array(ids.length * 4);
      ids.forEach((id, v) => {
        joints.fill(id, v * 4, v * 4 + 4);
        weights[v * 4] = 1;
      });
      copy.geometry.setAttribute('skinIndex', new BufferAttribute(joints, 4));
      copy.geometry.setAttribute('skinWeight', new BufferAttribute(weights, 4));
    }
    const record = session.wordOfWorld(copy.matrix);
    if (!record) continue;
    Object.assign(copy, { deformRecord: record, frustumCulled: false });
    deformedGeometries.add(copy.geometry);
  }
  // Records and whole copies are fixed with the session: so are the bytes they pin.
  let bytes = session.any ? deformationTextureBytes(frame.block.length / 4) : 0;
  for (const geometry of deformedGeometries) bytes += geometryDeformationBytes(geometry);
  return {
    /** Control records and whole-copy sources are pinned in the same geometry budget. */
    bytes: () => bytes,
    /** The records the program reads, none when no root deforms. */
    source: () => (session.any ? source : undefined),
    /** What a page mesh of `rec` carries: its placement's record, zero for none. */
    wordOf: (rec: PageRec) => session.wordOfWorld(rootOf(roots, rec).world),
    pending: () => session.any && frame.pending(),
    update(cam: EngineCamera, viewport: readonly number[] | undefined, pixelError: number) {
      if (!session.any) return;
      session.update(cam, viewport, pixelError);
      for (let i = 0; i < roots.length; i++) if (frame.bases[i]) roots[i].reach = frame.reach[i];
    },
  };
}

export type WebglDeformation = ReturnType<typeof createWebglDeformation>;
