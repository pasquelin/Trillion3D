import { createViewFingerprint } from './viewFingerprint.ts';
import type { EngineCamera } from './cameraWorld.ts';
import { bumpView, type FrameRevisions } from './frameRevisions.ts';

/**
 * L'origine de la révision de vue. La caméra n'est pas écrite par le moteur : l'hôte la lui tend à
 * chaque image. Comparer les seize nombres de la vue et ceux de la projection, la résolution et le
 * seuil de qualité EST donc l'origine du changement, au même titre qu'un `setTransform` l'est pour
 * la scène — c'est déjà ce que le Hi-Z temporel fait de son côté (`sameHizView`).
 *
 * Vue, projection, plan proche et viewport sont l'empreinte commune aux deux tenues d'image
 * (`viewFingerprint.ts`) ; la portée du plan lointain et le seuil de qualité n'appartiennent qu'à
 * celle-ci.
 */
export function createViewRevision() {
  const fingerprint = createViewFingerprint();
  let far = NaN,
    quality = NaN,
    armed = false;
  return {
    /** Relit la vue de cette image ; incrémente `view` et rend vrai si l'un de ces nombres a bougé. */
    read(
      revisions: FrameRevisions,
      cam: EngineCamera,
      viewportWidth: number,
      viewportHeight: number,
      pixelError: number,
    ) {
      // La pose de la caméra, ancêtres compris, est celle que l'entrée d'image vient de recopier :
      // toute entrée appelle `readCameraWorld` avant le seuil adaptatif et avant cette lecture, et
      // rien d'autre n'entre ici. C'est l'ordre que garantit le contrat (`cameraWorld.ts`), et
      // c'est par cette seule empreinte qu'une pose décide de tenir ou de rejouer une image.
      if (
        armed &&
        far === cam.far &&
        quality === pixelError &&
        fingerprint.same(cam, viewportWidth, viewportHeight)
      )
        return false;
      fingerprint.keep(cam, viewportWidth, viewportHeight);
      far = cam.far;
      quality = pixelError;
      armed = true;
      bumpView(revisions);
      return true;
    },
  };
}
