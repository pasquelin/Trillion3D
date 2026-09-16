import {
  MAX_HIZ_LEVELS,
  UNIFORM_U32,
  UNI_LEVELS,
  UNI_SCALARS,
  UNI_VIEW,
  UNI_VIEW_PROJ,
} from './gpuPartitionContract.ts';

/** Ce qu'une image dit à la partition, et rien de plus : deux matrices, sept entiers, un plan. */
export type PartitionFrame = {
  view: ArrayLike<number>;
  viewProj: ArrayLike<number>;
  near: number;
  rows: number;
  width: number;
  height: number;
  /** Mips de la pyramide Hi-Z, avec leur décalage et leur largeur ; zéro quand il n'y en a pas. */
  levels: Array<{ offset: number; width: number }>;
  /** Couche coplanaire la plus haute qu'un slot indirect nomme. */
  layerTop: number;
  /** Faux dès que la table de lignes a changé d'âge : l'historique par ligne ne décrit plus rien. */
  historyValid: boolean;
  /** Faux quand aucun pipeline ne sait dessiner la moitié testée : l'image reste en une passe. */
  hasRest: boolean;
};

/** Le tampon d'uniforme réutilisé d'une image à l'autre : un écrivain, aucune allocation. */
export function createPartitionUniformWriter() {
  const words = new Uint32Array(UNIFORM_U32),
    floats = new Float32Array(words.buffer);
  return (device: GPUDevice, target: GPUBuffer, frame: PartitionFrame) => {
    for (let i = 0; i < 16; i++) {
      floats[UNI_VIEW + i] = frame.view[i];
      floats[UNI_VIEW_PROJ + i] = frame.viewProj[i];
    }
    words[UNI_SCALARS] = frame.rows;
    words[UNI_SCALARS + 1] = frame.width;
    words[UNI_SCALARS + 2] = frame.height;
    words[UNI_SCALARS + 3] = Math.min(frame.levels.length, MAX_HIZ_LEVELS);
    words[UNI_SCALARS + 4] = frame.layerTop;
    words[UNI_SCALARS + 5] = frame.historyValid ? 1 : 0;
    words[UNI_SCALARS + 6] = frame.hasRest ? 1 : 0;
    floats[UNI_SCALARS + 7] = frame.near;
    for (let level = 0; level < MAX_HIZ_LEVELS; level++) {
      const mip = frame.levels[level];
      words[UNI_LEVELS + level] = mip ? mip.offset : 0;
      words[UNI_LEVELS + MAX_HIZ_LEVELS + level] = mip ? mip.width : 1;
    }
    device.queue.writeBuffer(target, 0, words);
  };
}
