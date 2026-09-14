import type { LightingSceneLight, Scene } from './lightingSceneTypes.ts';
import { validateLightingSceneControls } from './lightingSceneControls.ts';
import {
  createLightingSceneGeometry,
  createLightingScenePatches,
} from './lightingSceneGeometry.ts';
import { addLightingSceneRooms } from './lightingSceneRooms.ts';
import { addLightingSceneObjects } from './lightingSceneObjects.ts';

export type { Vec3, LightingSceneLight, Surface, Patch, Scene } from './lightingSceneTypes.ts';
export {
  createDefaultLightingSceneLights,
  LIGHTING_CAMERA_POSES,
} from './lightingSceneControls.ts';
export { exportLightingGltf } from './lightingSceneGltf.ts';

/** Door angle zero closes the opening; PI/2 swings the leaf into the left room. */
export function createLightingScene(options: {
  doorAngle: number;
  lightIntensity: number;
  patchSize?: number;
  roughness?: number;
  /** Omit for all three panels; an explicit subset selects a fixed smaller fixture. */
  lights?: readonly LightingSceneLight[];
}): Scene {
  const { doorAngle, lightIntensity, patchSize = 1.2, roughness = 0.12 } = options;
  const lights = validateLightingSceneControls(
    doorAngle,
    lightIntensity,
    patchSize,
    roughness,
    options,
  );
  const geometry = createLightingSceneGeometry(patchSize);
  addLightingSceneRooms(geometry, doorAngle);
  addLightingSceneObjects(geometry, lights, lightIntensity);
  const { surfaces } = geometry;
  const patches = createLightingScenePatches(surfaces);
  return { surfaces, patches, sphere: { center: [2, 0.5, 0], radius: 0.45, roughness } };
}
