import type * as THREE from 'three';
import {
  bumpResources,
  bumpScene,
  bumpView,
  createFrameHold,
  createFrameRevisions,
} from './frameRevisions.ts';
import { createViewRevision } from './frameViewRevision.ts';
import { createHostSceneWatch, type WatchedSources } from './hostSceneWatch.ts';
import {
  createEngineCamera,
  readCameraWorld,
  type CameraMotion,
  type EngineCamera,
  type HostCamera,
} from './cameraWorld.ts';
import { resolvePixelError } from './pageSelection.ts';

export type FrameGateCore = ReturnType<typeof createFrameGateCore>;

/** Ce que l'entrée d'image relit du graphe source, ou de quoi le relire quand la liste elle-même
 *  n'est refaite qu'à un changement de scène : l'appel n'a alors rien à construire par image. */
type FrameGateSources = WatchedSources | (() => WatchedSources);

/**
 * La porte d'image commune aux deux moteurs : les trois révisions, l'origine de la vue, la relecture
 * du graphe que l'hôte peut écrire, et le témoin d'image tenue. `holdValues` est le nombre de valeurs
 * que la signature d'une image de ce moteur porte.
 */
export function createFrameGateCore(holdValues: number) {
  const revisions = createFrameRevisions();
  const viewRevision = createViewRevision();
  const hold = createFrameHold(holdValues);
  const sceneWatch = createHostSceneWatch();
  // La caméra que le moteur possède : l'entrée d'image y recopie celle de l'hôte, une fois, et tout
  // l'aval la lit. Allouée ici, jamais par image.
  const cam = createEngineCamera();
  let worldsRevision = 0,
    watchRevision = -1,
    pixelError = 0;
  const gate = {
    revisions,
    hold,
    /** La caméra du moteur de l'image en cours, telle que `enterFrame` vient de la recopier. */
    cam,
    /** Le seuil de qualité que `enterFrame` vient de résoudre pour l'image en cours. */
    get pixelError() {
      return pixelError;
    },
    /** La scène a bougé : matrices, matériaux, instances, lampes, vue de diagnostic. */
    sceneChanged: () => bumpScene(revisions),
    /**
     * Les ressources ont bougé : octets d'une page, résidence, géométrie remplacée, et tout ce
     * qui arrive hors du fil de l'image — un programme qui finit de compiler, un proxy adopté à
     * la résolution d'une promesse. Aucune étape de l'image en cours ne l'écrira, et l'image
     * suivante la lirait sans qu'aucun compteur ne l'annonce : c'est donc à l'arrivée que la
     * révision est incrémentée, ce qui casse la tenue du même coup.
     */
    resourcesChanged: () => bumpResources(revisions),
    /** La cible ne porte plus l'image de cette vue : une capture y a rendu depuis une autre caméra. */
    viewReplaced: () => bumpView(revisions),
    /** Relit la vue de cette image ; rend vrai si l'un de ses nombres a bougé. */
    viewChanged(vue: EngineCamera, viewport: readonly [number, number] | undefined, error: number) {
      return viewRevision.read(
        revisions,
        vue,
        viewport ? viewport[0] : -1,
        viewport ? viewport[1] : -1,
        error,
      );
    },
    /**
     * Relit les nœuds source et déclare la scène changée quand l'hôte les a écrits directement —
     * une pose, une visibilité, une lampe —, sans passer par le moteur. À appeler AVANT `held()` :
     * sans cela l'image serait tenue sur une scène périmée. Rien n'est remonté ici : seules les
     * poses locales sont comparées, et la comparaison est idempotente.
     *
     * La liste des nœuds relus est refaite après chaque changement de scène, jamais par image : une
     * instance de plus ou une lampe posée après coup passe par là, et rien d'autre ne l'ajoute.
     */
    readScene(source: THREE.Object3D, drawn: FrameGateSources) {
      if (watchRevision !== revisions.scene) {
        sceneWatch.observe(source, typeof drawn === 'function' ? drawn() : drawn);
        watchRevision = revisions.scene;
      }
      if (sceneWatch.changed()) bumpScene(revisions);
    },
    /** Vrai quand deux images identiques se sont suivies et que rien n'a bougé depuis. */
    held: () => hold.stable && hold.same(revisions),
    /** Remonte la hiérarchie une fois par révision de scène ; rend vrai quand elle l'a fait. Une
     *  image que rien n'a touchée ne remonte rien : c'est `readScene` qui sait si rien n'a bougé. */
    updateWorlds(source: THREE.Object3D) {
      if (worldsRevision === revisions.scene) return false;
      worldsRevision = revisions.scene;
      source.updateMatrixWorld(true);
      return true;
    },
    /** La hiérarchie porte déjà les matrices de la révision en cours : écrit par qui vient de les
     *  remonter lui-même, sur le seul sous-arbre qu'il a déplacé. */
    noteWorldsUpdated() {
      worldsRevision = revisions.scene;
    },
    /**
     * L'entrée d'image, dans l'ordre que tout moteur suit, et qui porte le verdict de tenue.
     *
     * La pose monde de la caméra, ancêtres compris, est résolue et recopiée dans la caméra du
     * moteur d'abord et une seule fois — vue, vue-projection, plans du tronc, œil : le seuil
     * adaptatif la lit, puis l'empreinte de vue (contrat et garanties : `cameraWorld.ts`). La vitesse
     * de la caméra se lit à chaque image, tenue ou non : la sauter fausserait le seuil adaptatif de
     * la première image qui bouge à nouveau. Enfin l'hôte a le droit d'écrire le graphe source sans
     * passer par le moteur : la relecture est ce qui l'annonce, et elle précède la décision de tenir.
     */
    enterFrame(
      context: { pixelError?: number; lodAdaptive?: boolean },
      camera: HostCamera,
      motion: CameraMotion,
      viewport: readonly [number, number] | undefined,
      source: THREE.Object3D,
      drawn: FrameGateSources,
    ) {
      readCameraWorld(cam, camera);
      pixelError = resolvePixelError(context, cam, motion);
      gate.viewChanged(cam, viewport, pixelError);
      gate.readScene(source, drawn);
      return gate.held();
    },
  };
  return gate;
}
