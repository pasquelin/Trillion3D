import { copyElements, sameElements } from './matrixElements.ts';
import type { EngineCamera } from './cameraWorld.ts';

/**
 * L'empreinte d'une vue d'image : les seize nombres de la vue, les seize de la projection, le plan
 * proche et le viewport. Deux tenues comparaient exactement cela et le recopiaient chacune pour son
 * compte — la révision de vue des moteurs rendus par Three (`frameViewRevision.ts`) et la tenue des
 * rectangles d'écran du Hi-Z (`hizProjectionHold.ts`) —, avec deux `Float64Array(16)` et la même
 * suite de comparaisons. Une seule écriture ; ce qui distingue une tenue de l'autre, portée du plan
 * lointain et seuil de qualité d'un côté, âge de la table de l'autre, reste chez elle.
 *
 * Aucune tolérance, et rien qui se lise ailleurs que sur la caméra du moteur : une vue qui a bougé
 * d'un dernier bit est une vue différente.
 */
export function createViewFingerprint() {
  const view = new Float64Array(16),
    projection = new Float64Array(16);
  // Rien n'est encore retenu : `NaN` ne s'égale pas lui-même, donc la première image diffère.
  let near = NaN,
    width = -1,
    height = -1;
  return {
    /** Vrai quand la vue, la projection, le plan proche et le viewport sont ceux déjà retenus. */
    same(cam: EngineCamera, viewportWidth: number, viewportHeight: number) {
      return (
        near === cam.near &&
        width === viewportWidth &&
        height === viewportHeight &&
        sameElements(view, cam.view) &&
        sameElements(projection, cam.projection)
      );
    },
    /** Retient cette vue-ci, sans rien allouer. */
    keep(cam: EngineCamera, viewportWidth: number, viewportHeight: number) {
      copyElements(view, cam.view);
      copyElements(projection, cam.projection);
      near = cam.near;
      width = viewportWidth;
      height = viewportHeight;
    },
  };
}
