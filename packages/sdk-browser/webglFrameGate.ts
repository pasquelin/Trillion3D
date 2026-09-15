import type * as THREE from 'three';
import {
  bumpResources,
  bumpScene,
  createFrameHold,
  createFrameRevisions,
} from './frameRevisions.ts';
import { createViewRevision } from './frameViewRevision.ts';

/** Ce qu'une image WebGL a produit d'observable : voir `sample` ci-dessous. */
export const WEBGL_HOLD_VALUES = 6;

export type WebglFrameGate = ReturnType<typeof createWebglFrameGate>;

/**
 * La porte d'image des moteurs rendus par Three : les trois révisions, l'origine de la vue, et le
 * témoin d'image tenue.
 *
 * Un moteur WebGL ne soumet rien lui-même — l'hôte rend le graphe qu'il tient. Une image tenue n'a
 * donc rien à réémettre : la scène attachée EST déjà l'image, et ne rien faire la redonne au pixel
 * près. Ce qui est supprimé est la coupe, la remontée des matrices et la mise à jour des lampes.
 */
export function createWebglFrameGate() {
  const revisions = createFrameRevisions();
  const viewRevision = createViewRevision();
  const hold = createFrameHold(WEBGL_HOLD_VALUES);
  let worldsRevision = 0;
  return {
    revisions,
    hold,
    /** La scène a bougé : matrices, matériaux, instances, lampes, vue de diagnostic. */
    sceneChanged: () => bumpScene(revisions),
    /** Les ressources ont bougé : octets d'une page, résidence, géométrie remplacée. */
    resourcesChanged: () => bumpResources(revisions),
    /** Relit la vue de cette image ; rend vrai si l'un de ses nombres a bougé. */
    viewChanged(
      camera: THREE.PerspectiveCamera,
      viewport: readonly [number, number] | undefined,
      pixelError: number,
    ) {
      return viewRevision.read(
        revisions,
        camera,
        viewport ? viewport[0] : -1,
        viewport ? viewport[1] : -1,
        pixelError,
      );
    },
    /** Vrai quand deux images identiques se sont suivies et que rien n'a bougé depuis. */
    held: () => hold.stable && hold.same(revisions),
    /** Remonte la hiérarchie une fois par révision de scène ; rend vrai quand elle l'a fait. */
    updateWorlds(source: THREE.Object3D) {
      if (worldsRevision === revisions.scene) return false;
      worldsRevision = revisions.scene;
      source.updateMatrixWorld(true);
      return true;
    },
    /**
     * Range l'image qui vient d'être produite. Les six nombres décrivent la coupe entière : deux
     * images qui les partagent ont attaché exactement les mêmes clusters, donc dessinent la même
     * image — et la coupe suivante, qui relit `shown`, repartirait du même point fixe.
     */
    keep(
      visible: number,
      selectedTriangles: number,
      frustumRejected: number,
      lodLevel: number,
      shown: number,
      overBudget: boolean,
    ) {
      const sample = hold.sample;
      sample[0] = visible;
      sample[1] = selectedTriangles;
      sample[2] = frustumRejected;
      sample[3] = lodLevel;
      sample[4] = shown;
      sample[5] = overBudget ? 1 : 0;
      hold.keep(revisions);
    },
  };
}
