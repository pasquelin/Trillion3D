import {
  MAX_HIZ_LEVELS,
  UNI_ANCHOR_LOW,
  UNIFORM_U32,
  UNI_ANCHOR,
  UNI_LEVELS,
  UNI_SCALARS,
  UNI_VIEW,
  UNI_VIEW_PROJ,
} from './gpuPartitionContract.ts';

/** Ce qu'une image dit à la partition, et rien de plus : deux matrices, une ancre, sept entiers. */
export type PartitionFrame = {
  /** Éléments de la vue et de la vue-projection en double précision, en coordonnées MONDE. */
  view: ArrayLike<number>;
  viewProj: ArrayLike<number>;
  /**
   * Le point auquel la projection GPU rapporte les coins, en double précision : la pose de la
   * caméra. Les matrices envoyées au noyau sont composées avec cette translation, si bien qu'un
   * coin proche de la caméra n'y entre plus par ses coordonnées monde — c'est ce qui garde la borne
   * d'erreur serrée sur un modèle dont les coordonnées valent des dizaines de milliers.
   */
  anchor: readonly [number, number, number];
  near: number;
  rows: number;
  width: number;
  height: number;
  /** Mips de la pyramide Hi-Z, avec leur décalage et leur largeur ; vide quand il n'y en a pas. */
  levels: Array<{ offset: number; width: number }>;
  /** Couche coplanaire la plus haute qu'un slot indirect nomme. */
  layerTop: number;
  /** Faux dès que la table de lignes a changé d'âge : l'historique par ligne ne décrit plus rien. */
  historyValid: boolean;
  /** Faux quand aucun pipeline ne sait dessiner la moitié testée : l'image reste en une passe. */
  hasRest: boolean;
};

/**
 * `M · T(a)` : la même matrice, appliquée à un point rapporté à l'ancre. Seule la quatrième colonne
 * change, et elle vaut `M · (a, 1)` — le calcul se fait en double précision avant l'arrondi, si bien
 * que la composition n'ajoute aucune erreur à celle que le noyau borne déjà.
 */
function writeAnchored(
  into: Float32Array,
  at: number,
  elements: ArrayLike<number>,
  [ax, ay, az]: readonly [number, number, number],
) {
  for (let i = 0; i < 12; i++) into[at + i] = elements[i];
  for (let row = 0; row < 4; row++)
    into[at + 12 + row] =
      elements[row] * ax + elements[4 + row] * ay + elements[8 + row] * az + elements[12 + row];
}

/** Le tampon d'uniforme réutilisé d'une image à l'autre : un écrivain, aucune allocation. */
export function createPartitionUniformWriter() {
  const words = new Uint32Array(UNIFORM_U32),
    floats = new Float32Array(words.buffer);
  return (device: GPUDevice, target: GPUBuffer, frame: PartitionFrame) => {
    writeAnchored(floats, UNI_VIEW, frame.view, frame.anchor);
    writeAnchored(floats, UNI_VIEW_PROJ, frame.viewProj, frame.anchor);
    // L'ancre part elle aussi en deux mots : le noyau retranche les deux, et l'écart qu'il obtient
    // vaut celui du double d'origine à un ulp au carré près.
    for (let i = 0; i < 3; i++) {
      const high = Math.fround(frame.anchor[i]);
      floats[UNI_ANCHOR + i] = high;
      floats[UNI_ANCHOR_LOW + i] = frame.anchor[i] - high;
    }
    floats[UNI_ANCHOR + 3] = frame.near;
    floats[UNI_ANCHOR_LOW + 3] = 0;
    words[UNI_SCALARS] = frame.rows;
    words[UNI_SCALARS + 1] = frame.width;
    words[UNI_SCALARS + 2] = frame.height;
    words[UNI_SCALARS + 3] = Math.min(frame.levels.length, MAX_HIZ_LEVELS);
    words[UNI_SCALARS + 4] = frame.layerTop;
    words[UNI_SCALARS + 5] = frame.historyValid ? 1 : 0;
    words[UNI_SCALARS + 6] = frame.hasRest ? 1 : 0;
    words[UNI_SCALARS + 7] = 0;
    for (let level = 0; level < MAX_HIZ_LEVELS; level++) {
      const mip = frame.levels[level];
      words[UNI_LEVELS + level] = mip ? mip.offset : 0;
      words[UNI_LEVELS + MAX_HIZ_LEVELS + level] = mip ? mip.width : 1;
    }
    device.queue.writeBuffer(target, 0, words);
  };
}
