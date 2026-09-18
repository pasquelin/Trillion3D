import {
  IDENTITY_MATRIX4,
  invertMatrix4,
  multiplyMatrix4,
  transformAffinePoint,
  worldToRenderOrigin,
} from '../sdk-core/index.ts';
import { sameElements, type MatrixElements } from './matrixElements.ts';

/** Ce que le mouvement d'un placement demande d'une racine : sa matrice monde de l'hôte. */
export type MotionRoot = { world: MatrixElements };

/**
 * Les matrices de mouvement des placements, telles que la passe temporelle les lit : une `mat4x4f`
 * par racine, l'identité pour un placement immobile, `précédent · courant⁻¹` — rapportée à l'œil —
 * pour celui qui a bougé depuis la dernière image accumulée. C'est ce que la référence garde dans
 * ses données d'instance pour les seuls objets dynamiques : ici l'entrée existe pour chaque
 * racine, mais seules celles qui bougent sont réécrites, et remises à l'identité l'image d'après.
 * Un miroir processeur porte le tampon entier ; une image n'envoie que la plage qu'elle a touchée,
 * en une seule écriture.
 *
 * L'ancrage sur l'œil suit la partition : la position que la passe reprojette est relative à l'œil
 * de l'image, donc `M` s'écrit `T(−œil) · M · T(œil)`, dont seule la colonne de translation change
 * — `M · (œil, 1) − œil`, calculée en double avant l'arrondi simple.
 */
export function createPlacementMotion(device: GPUDevice, roots: readonly MotionRoot[]) {
  const count = Math.max(1, roots.length);
  const mirror = new Float32Array(count * 16);
  for (let w = 0; w < count; w++) mirror.set(IDENTITY_MATRIX4, w * 16);
  const buffer = device.createBuffer({
    label: 'WG TAA placement motion v1',
    size: mirror.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, mirror);
  /** La pose de chaque racine à la dernière image accumulée. */
  const previous = new Float64Array(count * 16);
  const rememberPoses = () => {
    for (let w = 0; w < roots.length; w++) previous.set(roots[w].world.elements, w * 16);
  };
  rememberPoses();
  /** Les racines dont l'entrée n'est pas l'identité. */
  const moved: number[] = [];
  const current = new Float64Array(16),
    motion = new Float64Array(16);
  let from = count,
    to = -1;
  const touch = (w: number) => {
    from = Math.min(from, w);
    to = Math.max(to, w);
  };
  /** Remet à l'identité ce qui avait bougé, sans l'envoyer encore. */
  const clearMoved = () => {
    for (const w of moved) {
      mirror.set(IDENTITY_MATRIX4, w * 16);
      touch(w);
    }
    moved.length = 0;
  };
  const flush = () => {
    if (to < from) return;
    device.queue.writeBuffer(buffer, from * 64, mirror, from * 16, (to - from + 1) * 16);
    from = count;
    to = -1;
  };
  return {
    buffer,
    /** Vrai quand au moins une racine porte un mouvement à cette image. */
    get moved() {
      return moved.length > 0;
    },
    /**
     * À chaque image accumulée : remet à l'identité ce qui avait bougé à la précédente, puis écrit
     * `M` pour chaque racine dont la pose diffère de celle de la dernière image accumulée, et
     * retient la pose. `scan` faux dit qu'aucune matrice de scène n'a changé : rien n'est comparé.
     */
    update(eye: ArrayLike<number>, scan: boolean) {
      clearMoved();
      if (scan)
        for (let w = 0; w < roots.length; w++) {
          const elements = roots[w].world.elements,
            at = w * 16;
          if (sameElements(previous.subarray(at, at + 16), elements)) continue;
          current.set(elements);
          invertMatrix4(current, current);
          multiplyMatrix4(motion, previous.subarray(at, at + 16), current);
          // `M · (œil, 1)` en colonne de translation, puis `− œil` au passage en simple précision.
          transformAffinePoint(motion, motion, eye[0], eye[1], eye[2], 12);
          worldToRenderOrigin(mirror, motion, eye, at);
          previous.set(elements, at);
          moved.push(w);
          touch(w);
        }
      flush();
    },
    /** L'historique est perdu : les poses courantes deviennent la référence, sans mouvement. */
    reset() {
      clearMoved();
      flush();
      rememberPoses();
    },
    dispose() {
      buffer.destroy();
    },
  };
}
