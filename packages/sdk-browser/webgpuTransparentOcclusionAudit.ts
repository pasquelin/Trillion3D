import { readGpuBuffer, readGpuTextureR32F } from './gpuReadback.ts';
import { visLayerTop } from './webgpuVisibilityUniforms.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Doubles d'une boîte monde : huit coins de trois coordonnées, comme `createBoxCorners` les tient. */
const BOX_CORNER_VALUES = 24;

/**
 * Ce que le test d'occultation des transparents a REJETÉ sur la dernière image, et de quoi le
 * réfuter sans rien croire de la carte.
 *
 * Chaque grappe rejetée sort avec ses coins monde en double précision et les matrices de l'image ;
 * la profondeur de l'image sort avec elle, pleine résolution, telle que la passe opaque l'a laissée.
 * Un appelant refait donc la projection de référence, prend le maximum de profondeur sur le
 * rectangle de RÉFÉRENCE — le plus serré des deux — et vérifie que la borne de référence est
 * encore au-delà : la grappe était bel et bien entièrement derrière l'opaque.
 *
 * Ce n'est pas une passe de l'image : rien n'existe tant que l'hôte ne le demande pas.
 */
export interface TransparentOcclusionAudit {
  width: number;
  height: number;
  near: number;
  view: Float64Array;
  viewProj: Float64Array;
  /** Couche coplanaire dont le biais a servi à toutes les entrées : la plus haute de l'image. */
  layer: number;
  /** Entrées de la table que le test a rejetées, dans l'ordre de la table. */
  rejected: Uint32Array;
  /** Coins monde des entrées rejetées, huit par entrée, dans le même ordre. */
  corners: Float64Array;
  /** Profondeur de l'image, un flottant par pixel, ligne par ligne depuis le haut. */
  depth: Float32Array;
  /** Entrées que le test a examinées : toutes celles qui nomment une page. */
  examined: number;
}

export async function readTransparentOcclusionAudit(
  rt: WebgpuPagesRuntime,
): Promise<TransparentOcclusionAudit | null> {
  const { blendState, layout, vis } = rt,
    device = rt.setup.gpuDevice,
    table = blendState.table,
    compaction = blendState.compaction,
    frame = vis.gpuPartition?.lastFrame;
  if (!device || !table || !compaction || !blendState.occlusion || !frame || !vis.gpuHiz)
    return null;
  const words = await readGpuBuffer(device, compaction.occludedBuffer, table.capacity * 4);
  if (!words) return null;
  const verdicts = new Uint32Array(words.buffer, words.byteOffset, table.capacity);
  const keep: number[] = [];
  let examined = 0;
  for (let entry = 0; entry < table.capacity; entry++) {
    if (table.pageOfEntry[entry] < 0) continue;
    examined++;
    if (verdicts[entry]) keep.push(entry);
  }
  const depth = await readGpuTextureR32F(device, vis.gpuHiz.level0, frame.width, frame.height);
  if (!depth) return null;
  const rejected = Uint32Array.from(keep);
  const corners = new Float64Array(rejected.length * BOX_CORNER_VALUES);
  const { boxCorners, packedPages, rows } = layout;
  for (let i = 0; i < rejected.length; i++) {
    const page = table.pageOfEntry[rejected[i]];
    const at = boxCorners.at(page, packedPages[page], rows.tableEpoch);
    for (let k = 0; k < BOX_CORNER_VALUES; k++)
      corners[i * BOX_CORNER_VALUES + k] = boxCorners.corners[at + k];
  }
  return {
    width: frame.width,
    height: frame.height,
    near: frame.near,
    view: frame.view,
    viewProj: frame.viewProj,
    layer: visLayerTop(vis),
    rejected,
    corners,
    depth,
    examined,
  };
}
