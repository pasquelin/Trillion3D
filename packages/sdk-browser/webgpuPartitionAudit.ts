import { FLAG_CLIP, ROW_DATA_U32, ROW_FLAGS, ROW_NEAREST } from './gpuPartitionContract.ts';
import { visLayerTop } from './webgpuVisibilityUniforms.ts';

/** Doubles d'une boîte monde : huit coins de trois coordonnées, comme `createBoxCorners` les tient.
 *  C'est la disposition de la RÉFÉRENCE, pas celle du tampon en deux mots que le noyau lit. */
const BOX_CORNER_VALUES = 24;
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Ce qu'une image a envoyé à la partition GPU, et ce que la partition en a écrit, ligne par ligne.
 *
 * C'est l'outil de preuve de la conservativité : le rectangle d'écran et la borne de profondeur que
 * la carte a calculés en simple précision, à côté des coins monde en double précision et des
 * matrices d'où ils sortent. Un appelant peut donc refaire le calcul de référence sur les MÊMES
 * entrées et vérifier, cluster par cluster, que le rectangle de la carte contient celui de la
 * référence, qu'une boîte coupée par le plan proche porte bien son drapeau, et que la profondeur de
 * la carte minore celle de la référence.
 *
 * Ce n'est pas une passe de l'image : rien de tout cela n'existe tant que l'hôte ne le demande pas,
 * et la lecture n'a de sens qu'après une image rendue.
 */
export interface PartitionAudit {
  rows: number;
  width: number;
  height: number;
  near: number;
  /** Éléments de la vue et de la vue-projection en double précision, tels que l'image les a posés. */
  view: Float64Array;
  viewProj: Float64Array;
  /** Coins monde en double précision, huit par ligne : l'entrée exacte des deux calculs. */
  corners: Float64Array;
  /** Couche coplanaire de chaque ligne, telle que la fiche de dessin la porte. */
  layers: Uint32Array;
  /** Rectangle d'écran non découpé que la carte a écrit, quatre entiers par ligne. */
  rect: Int32Array;
  /** Borne de profondeur que la carte a écrite, biais de couche compris. */
  nearest: Float32Array;
  /** 1 quand la ligne porte le drapeau de coupe, donc ne peut jamais être rejetée. */
  clips: Uint8Array;
}

/**
 * Lit les rectangles et les profondeurs que la partition GPU a écrits pour la dernière image, avec
 * les entrées d'où elle les a tirés. `null` quand aucune partition ne tourne ou qu'aucune image ne
 * l'a encore encodée.
 */
export async function readPartitionAudit(rt: WebgpuPagesRuntime): Promise<PartitionAudit | null> {
  const partition = rt.vis.gpuPartition,
    device = rt.setup.gpuDevice,
    frame = partition?.lastFrame;
  if (!partition || !device || !frame) return null;
  const { rows } = frame;
  if (rows < 1) return null;
  const words = await partition.readRowData(rows);
  if (!words) return null;
  const rect = new Int32Array(rows * 4),
    nearest = new Float32Array(rows),
    clips = new Uint8Array(rows),
    layers = new Uint32Array(rows),
    corners = new Float64Array(rows * BOX_CORNER_VALUES);
  const ints = new Int32Array(words.buffer, words.byteOffset, words.length),
    floats = new Float32Array(words.buffer, words.byteOffset, words.length);
  const { boxCorners, rows: table } = rt.layout;
  for (let row = 0; row < rows; row++) {
    const base = row * ROW_DATA_U32;
    for (let k = 0; k < 4; k++) rect[row * 4 + k] = ints[base + k];
    nearest[row] = floats[base + ROW_NEAREST];
    clips[row] = words[base + ROW_FLAGS] & FLAG_CLIP ? 1 : 0;
    const rec = table.packedRecs[row];
    layers[row] = rec ? Math.min(rec.depthLayer, visLayerTop(rt.vis)) : 0;
    if (!rec) continue;
    // Les coins que la carte a lus sont ceux-ci, arrondis en simple précision pour le transport :
    // la référence part donc des mêmes doubles, et l'arrondi entre dans la borne d'erreur du noyau.
    const at = boxCorners.at(table.packedPageIndex[row], rec, table.tableEpoch);
    for (let k = 0; k < BOX_CORNER_VALUES; k++)
      corners[row * BOX_CORNER_VALUES + k] = boxCorners.corners[at + k];
  }
  return {
    rows,
    width: frame.width,
    height: frame.height,
    near: frame.near,
    view: frame.view,
    viewProj: frame.viewProj,
    corners,
    layers,
    rect,
    nearest,
    clips,
  };
}
