import {
  createEngineCamera,
  readCameraWorld,
  type EngineCamera,
  type HostCamera,
} from './world.ts';

/**
 * Engine camera of a test host camera: what frame entry does every frame, in one call.
 * Idempotent — an engine camera returns itself — so a bench or a test can apply it without
 * knowing what it holds. It allocates: the per-frame path rewrites the camera the engine
 * already owns (`run.cam`).
 */
export function cameraMoteur(source: HostCamera | EngineCamera): EngineCamera {
  return 'viewProjection' in source ? source : readCameraWorld(createEngineCamera(), source);
}
