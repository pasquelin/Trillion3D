import * as THREE from 'three';
import {
  createCameraFrame,
  decomposeMatrix4,
  perspectiveProjection,
  updateCameraFrame,
  type CameraFrame,
} from '../sdk-core/index.ts';
import { copyElements } from './matrixElements.ts';

/**
 * LE CONTRAT DE POSE CAMÉRA. Domicile unique de la pose monde d'une caméra dans `sdk-browser` ;
 * `test/engineStructure.test.mjs` interdit à tout autre module de la résoudre ou de lire une pose
 * locale de caméra, et nomme les consommateurs autorisés à lire la pose résolue. C'est aussi le seul
 * fichier du chemin par image qui nomme un type de la bibliothèque hôte : `test/engineNoThree.test.mjs`
 * interdit `three` partout ailleurs dans ce chemin.
 *
 * LE FAIT. Le moteur ne possède pas la caméra : l'hôte la lui tend à chaque image, et elle peut être
 * l'enfant d'un rig qui n'appartient à aucune scène préparée. `updateWorlds` ne remonte que la scène,
 * donc personne d'autre que l'hôte ne remonte ce rig, et l'hôte n'y est pas tenu. Lire `position`,
 * `quaternion` ou `matrixWorld` sans avoir résolu la chaîne d'ancêtres décrit alors une autre caméra
 * que celle depuis laquelle l'image est dessinée.
 *
 * LA RÈGLE, en trois temps.
 *  1. RÉSOUDRE. `resolveCameraWorld` est la seule façon de rendre la pose monde à jour, ancêtres
 *     compris. Une entrée d'image la lit UNE FOIS, avant tout le reste. Une fonction appelable seule
 *     — oracle, banc, diagnostic, hôte de test — la lit aussi en tête : elle ne peut pas savoir qui
 *     l'appelle. L'opération est idempotente et sans effet de bord hors de Three : elle ne lit que
 *     des matrices locales que le moteur n'écrit pas, si bien que la rappeler en aval ne change
 *     aucun nombre. C'est ce qui permet aux deux usages de coexister sans se contredire.
 *  2. RECOPIER. `readCameraWorld` résout puis recopie, une fois par image, la matrice monde et la
 *     matrice de projection de la caméra hôte dans une `EngineCamera` que le moteur possède —
 *     allouée une fois, réécrite à chaque image. Les matrices dérivées (vue, vue-projection, plans
 *     du tronc, position monde) sont posées là, une seule fois pour toute l'image.
 *  3. LIRE. Tout ce qui est en aval lit l'`EngineCamera`. `cameraWorldPosition` et `cameraPose`
 *     restent les lectures de pose des traces et des hôtes de test. Une lecture directe de
 *     `camera.position` est un défaut, jamais une optimisation — sous un rig elle nomme un point qui
 *     n'existe pas dans le monde.
 *
 * CE QUE LE CONTRAT GARANTIT SUR LES RÉVISIONS D'IMAGE. Rien ici ne lit ni n'incrémente une
 * révision : ni `scene`, ni `resources`, ni `view`. La pose entre dans la décision de tenir ou de
 * rejouer une image par un seul chemin, l'empreinte de vue (`frameViewRevision.ts`, que la porte
 * WebGL appelle `viewChanged`), qui compare les seize nombres de la vue. L'ORDRE est donc la
 * garantie : une entrée d'image recopie la pose AVANT le seuil adaptatif (`resolvePixelError`) et
 * AVANT l'empreinte de vue, et l'empreinte est relue AVANT la décision de tenue. Un rig que l'hôte
 * déplace sans toucher à la caméra fait ainsi bouger l'empreinte et rejoue l'image ; sans la
 * résolution préalable, l'empreinte ne verrait rien bouger et l'image serait tenue à tort. Une
 * résolution faite en aval, elle, n'ouvre ni ne ferme aucune porte : elle n'atteint aucune révision.
 */

/** La dernière position de l'œil, gardée d'une image à l'autre pour en tirer une vitesse. */
export type CameraMotion = { last?: Float64Array; lastMs?: number };

/** La caméra que l'hôte tend au moteur. Seul ce fichier la nomme. */
export type HostCamera = THREE.PerspectiveCamera;

/**
 * La caméra du moteur : les nombres d'une image, dans des tampons possédés et réécrits sur place.
 * Aucune structure de la bibliothèque hôte ne traverse une signature en aval de `readCameraWorld`.
 */
export interface EngineCamera extends CameraFrame {
  /** Matrice monde de la caméra hôte, recopiée telle quelle. */
  world: Float64Array;
  /** Projection du moteur, composée de l'optique déclarée par l'hôte : profondeur inversée, plan
   *  lointain infini (`depthConvention.ts`). Ce n'est PAS la matrice de la caméra hôte. */
  projection: Float64Array;
  /** Position de l'œil dans le monde : la translation de `world`. Elle ne se nomme pas `position`,
   *  qui désigne partout ailleurs la pose LOCALE que le contrat interdit de lire. */
  eye: Float64Array;
  near: number;
  far: number;
  /** Champ vertical en degrés et rapport d'image, tels que l'hôte les déclare. */
  fov: number;
  aspect: number;
}

export function createEngineCamera(): EngineCamera {
  return {
    ...createCameraFrame(),
    world: new Float64Array(16),
    projection: new Float64Array(16),
    eye: new Float64Array(3),
    near: 0,
    far: 0,
    fov: 0,
    aspect: 1,
  };
}

export function resolveCameraWorld<T extends THREE.Camera>(camera: T): T {
  camera.updateWorldMatrix(true, false);
  return camera;
}

/**
 * Recopie la caméra hôte dans la caméra du moteur, ancêtres résolus. La POSE vient de l'hôte, la
 * PROJECTION non : le moteur la compose de l'optique déclarée (champ, rapport, plan proche, zoom)
 * dans sa propre convention de profondeur — inversée, plan lointain infini — parce que la matrice
 * de l'hôte porte celle de sa bibliothèque et un plan lointain fini. `camera.far` reste lu tel quel
 * pour ce qui en dépend encore (seuil adaptatif, portée des ombres) ; il n'entre plus dans aucune
 * profondeur. `updateCameraFrame` refait ensuite la vue par inversion de la matrice monde, la
 * vue-projection et les six plans du tronc, une fois pour toute l'image.
 */
export function readCameraWorld(into: EngineCamera, camera: HostCamera): EngineCamera {
  resolveCameraWorld(camera);
  copyElements(into.world, camera.matrixWorld.elements);
  into.near = camera.near;
  into.far = camera.far;
  into.fov = camera.fov;
  into.aspect = camera.aspect;
  perspectiveProjection(into.projection, camera.fov, camera.aspect, camera.near, camera.zoom);
  updateCameraFrame(into, into.projection, into.world);
  into.eye[0] = into.world[12];
  into.eye[1] = into.world[13];
  into.eye[2] = into.world[14];
  return into;
}

let defaultEngine: EngineCamera | undefined;
/** La caméra du moteur qu'une caméra hôte neuve donne : le repli des oracles que l'hôte appelle
 *  avant la première image, là où le moteur n'a encore recopié aucune caméra. */
export function defaultEngineCamera() {
  return (defaultEngine ??= readCameraWorld(createEngineCamera(), new THREE.PerspectiveCamera()));
}

const poseTranslation = new Float64Array(3),
  poseRotation = new Float64Array(4),
  poseScale = new Float64Array(3);

/**
 * La pose monde que publient les traces et les diagnostics, lue dans la caméra du moteur : l'œil est
 * la translation de `world`, et la décomposition du socle rend les bits de `Matrix4.decompose`, dont
 * `getWorldQuaternion` n'est que l'appel. Aucune caméra de l'hôte n'entre ici : la pose publiée est
 * celle de l'image dessinée, ancêtres compris, parce que `readCameraWorld` l'a résolue en tête.
 */
export function enginePose(cam: EngineCamera) {
  decomposeMatrix4(cam.world, poseTranslation, poseRotation, poseScale);
  return {
    position: [cam.eye[0], cam.eye[1], cam.eye[2]],
    quaternion: [poseRotation[0], poseRotation[1], poseRotation[2], poseRotation[3]],
  };
}

/**
 * Recopie `camera` dans `into`, caméra HÔTE sans parent qui garde sa pose monde au bit près : sa
 * matrice locale est la matrice monde de la source et ne se recompose plus depuis une position
 * locale. Une vue rendue à part — seconde vue de capture — décrit ainsi la vue réellement dessinée,
 * même quand la source est l'enfant d'un rig ; pour une caméra sans parent, rien ne change. La
 * source doit être à jour, ancêtres compris.
 */
export function holdHostCamera(into: HostCamera, camera: HostCamera): HostCamera {
  into.copy(camera, false);
  into.matrixAutoUpdate = false;
  into.matrix.copy(camera.matrixWorld);
  into.matrixWorld.copy(into.matrix);
  into.matrixWorldInverse.copy(into.matrixWorld).invert();
  return into;
}

/**
 * Recopie une caméra du moteur dans une autre, qui garde alors la vue au bit près. Une vue tenue
 * d'une image à l'autre (historique Hi-Z) ou rendue à part (seconde vue de capture) décrit ainsi la
 * vue réellement dessinée, même quand la source est l'enfant d'un rig. Rien n'est recalculé : les
 * matrices dérivées sont déjà posées chez la source.
 */
export function holdCameraWorld(into: EngineCamera, from: EngineCamera): EngineCamera {
  into.world.set(from.world);
  into.projection.set(from.projection);
  into.view.set(from.view);
  into.viewProjection.set(from.viewProjection);
  into.planes.set(from.planes);
  into.eye.set(from.eye);
  into.near = from.near;
  into.far = from.far;
  into.fov = from.fov;
  into.aspect = from.aspect;
  return into;
}
