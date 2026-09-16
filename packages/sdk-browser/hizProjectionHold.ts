import { createViewFingerprint } from './viewFingerprint.ts';
import type { EngineCamera } from './cameraWorld.ts';

/**
 * Which slots of the screen-rectangle table still describe this image, and which have to be
 * reprojected.
 *
 * A rectangle is a function of the box's world corners and of the view the image is drawn from, and
 * of nothing else. The corners are already held per page and rebuilt on their own epoch; this holds
 * the second half. The view is shared by every slot, so a camera that moved by a hair retires every
 * rectangle at once, and a view that did not move leaves each slot valid for as long as it keeps
 * pointing at the same page. What the caller then projects is the intersection of what it asks for
 * with what is not current — the same rectangles, written by the same arithmetic, for the slots that
 * need them.
 */
export function createProjectionHold(slots: number) {
  const size = Math.max(1, slots);
  const stamp = new Int32Array(size).fill(-1),
    heldPage = new Int32Array(size).fill(-1),
    pending = new Uint8Array(size);
  // Vue, projection, plan proche, viewport et révision du monde : tout ce dont un rectangle d'écran
  // dépend en dehors de la boîte elle-même. Les quatre premiers sont l'empreinte que la révision de
  // vue des moteurs Three compare aussi (`viewFingerprint.ts`) ; l'âge de la table n'est qu'à nous.
  const fingerprint = createViewFingerprint();
  let generation = 0,
    heldEpoch = -1;
  return {
    pending,
    /**
     * L'âge des rectangles d'écran : il change dès que la vue, le viewport ou l'âge de la table
     * retire les rectangles tenus. Ce que lit quiconque garde des bornes PROJETÉES et doit savoir
     * si elles décrivent encore cette image-ci.
     */
    get generation() {
      return generation;
    },
    /**
     * Relit la vue que tous les créneaux partagent ; un changement retire tous les rectangles d'un
     * coup. La vue vient de la caméra du moteur, que l'entrée d'image a recopiée par LE CONTRAT
     * (`cameraWorld.ts`) : sous un rig d'hôte, une caméra dont seul un ancêtre a bougé n'a pas de
     * pose locale nouvelle, et l'empreinte ne verrait rien bouger si la chaîne n'était pas résolue
     * d'abord. Le cache serait tenu à tort et le test Hi-Z recevrait les rectangles de la vue
     * précédente.
     */
    reframe(cam: EngineCamera, width: number, height: number, epoch: number) {
      if (heldEpoch === epoch && fingerprint.same(cam, width, height)) return;
      fingerprint.keep(cam, width, height);
      heldEpoch = epoch;
      generation++;
    },
    /**
     * Marque les créneaux que l'appelant doit projeter — ceux qu'il demande dont le rectangle n'est
     * pas celui de cette vue-ci — et rend COMBIEN il y en a. Le masque est l'argument `only` de
     * l'appelant ; zéro veut dire que le cache décrit déjà cette image.
     */
    select(count: number, only: Uint8Array | undefined, pageIndex: Int32Array) {
      let besoin = 0;
      for (let i = 0; i < count; i++) {
        const need =
          (!only || only[i] !== 0) && (stamp[i] !== generation || heldPage[i] !== pageIndex[i])
            ? 1
            : 0;
        pending[i] = need;
        besoin += need;
      }
      return besoin;
    },
    /** Records the rectangles the caller has just written. */
    keep(count: number, pageIndex: Int32Array) {
      for (let i = 0; i < count; i++)
        if (pending[i]) {
          stamp[i] = generation;
          heldPage[i] = pageIndex[i];
        }
    },
    /** Retires every rectangle: the table they describe is gone. */
    invalidate() {
      generation++;
    },
  };
}
