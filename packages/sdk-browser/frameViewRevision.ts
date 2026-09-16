import type * as THREE from 'three';
import { copyElements, sameElements } from './matrixElements.ts';
import { bumpView, type FrameRevisions } from './frameRevisions.ts';

/**
 * L'origine de la révision de vue. La caméra n'est pas écrite par le moteur : l'hôte la lui tend à
 * chaque image. Comparer les seize nombres de la vue et ceux de la projection, la résolution et le
 * seuil de qualité EST donc l'origine du changement, au même titre qu'un `setTransform` l'est pour
 * la scène — c'est déjà ce que le Hi-Z temporel fait de son côté (`sameHizView`).
 */
export function createViewRevision() {
  const view = new Float64Array(16),
    projection = new Float64Array(16);
  let near = NaN,
    far = NaN,
    width = -1,
    height = -1,
    quality = NaN,
    armed = false;
  return {
    /** Relit la vue de cette image ; incrémente `view` et rend vrai si l'un de ces nombres a bougé. */
    read(
      revisions: FrameRevisions,
      camera: THREE.PerspectiveCamera,
      viewportWidth: number,
      viewportHeight: number,
      pixelError: number,
    ) {
      // Ancêtres compris : sous un rig d'hôte, `updateMatrixWorld` relirait une pose périmée et
      // deux images différentes se donneraient la même révision — l'image serait tenue à tort.
      camera.updateWorldMatrix(true, false);
      const now = camera.matrixWorldInverse.elements,
        nowProjection = camera.projectionMatrix.elements;
      if (
        armed &&
        near === camera.near &&
        far === camera.far &&
        width === viewportWidth &&
        height === viewportHeight &&
        quality === pixelError &&
        sameElements(view, now) &&
        sameElements(projection, nowProjection)
      )
        return false;
      copyElements(view, now);
      copyElements(projection, nowProjection);
      near = camera.near;
      far = camera.far;
      width = viewportWidth;
      height = viewportHeight;
      quality = pixelError;
      armed = true;
      bumpView(revisions);
      return true;
    },
  };
}
