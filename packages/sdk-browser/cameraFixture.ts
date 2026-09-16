import {
  createEngineCamera,
  readCameraWorld,
  type EngineCamera,
  type HostCamera,
} from './cameraWorld.ts';

/**
 * La caméra du moteur d'une caméra d'hôte de test : ce que l'entrée d'image fait à chaque image, en
 * un appel. Idempotente — une caméra du moteur se rend elle-même —, pour qu'un banc ou un test
 * puisse l'appliquer sans savoir ce qu'il tient. Elle alloue : le chemin par image, lui, réécrit la
 * caméra que le moteur possède déjà (`run.cam`).
 */
export function cameraMoteur(source: HostCamera | EngineCamera): EngineCamera {
  return 'viewProjection' in source ? source : readCameraWorld(createEngineCamera(), source);
}
