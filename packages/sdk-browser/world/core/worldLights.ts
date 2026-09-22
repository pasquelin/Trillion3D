import { Box3 } from '../../../sdk-core/world/math/box3.ts';
import { Vector3 } from '../../../sdk-core/world/math/vector3.ts';
import type { Light } from '../../../sdk-core/world/light/light.ts';
import type { Object3D } from '../../../sdk-core/world/object/object3d.ts';
import { emptyIrradiance, type SceneLight } from '../../../sdk-core/index.ts';

/** The light calls of a session (`explorerLightApi.ts`) the world writes its lights through. */
type LightApi = {
  addLight(light: SceneLight): void;
  setLight(id: string, patch: Partial<Omit<SceneLight, 'id'>>): void;
  removeLight(id: string): void;
};

const corner = new Vector3(),
  eye = new Vector3();

export const isLight = (node: Object3D) => (node as { isLight?: boolean }).isLight === true;

/** True when `node` is a light or one hangs under it: moving the node moves the light. */
export function lightsUnder(node: Object3D) {
  let found = false;
  node.traverse((child) => {
    if (isLight(child)) found = true;
  });
  return found;
}

/**
 * Keeps a session's light store equal to the lights of a scene. A light the page left unbounded
 * reaches the farthest corner of what the scene holds, seen from where it stands: the range is
 * derived from the scene's own extent, never picked.
 */
export function createWorldLights() {
  const stored = new Map<Light, string>();
  let next = 1;
  return {
    /** The session changed: its store starts empty. */
    reset() {
      stored.clear();
    },
    /** Writes the lamps into the store and returns what every other light gives from every
     *  direction — ambient, sky over ground, probe — as the environment's irradiance, or
     *  undefined when none gives any. */
    sync(scene: Object3D, api: LightApi): number[] | undefined {
      const lights: Light[] = [];
      const sh = emptyIrradiance();
      let surrounding = false;
      scene.traverse((node) => {
        if (!(node as Light).isLight) return;
        lights.push(node as Light);
        if ((node as Light).addIrradiance(sh)) surrounding = true;
      });
      const bounds = new Box3().setFromObject(scene);
      const reach = (light: Light) => {
        light.getWorldPosition(eye);
        let far = 0;
        for (const x of [bounds.min.x, bounds.max.x])
          for (const y of [bounds.min.y, bounds.max.y])
            for (const z of [bounds.min.z, bounds.max.z])
              far = Math.max(far, corner.set(x, y, z).distanceTo(eye));
        return Number.isFinite(far) && far > 0 ? far : 1;
      };
      for (const [light, id] of stored)
        if (!lights.includes(light)) {
          api.removeLight(id);
          stored.delete(light);
        }
      for (const light of lights) {
        const id = stored.get(light) ?? `world-light-${next++}`;
        const record = light.sceneLight(id, reach(light));
        if (!record) {
          if (stored.has(light)) api.removeLight(id);
          stored.delete(light);
          continue;
        }
        if (stored.has(light)) api.removeLight(id);
        api.addLight(record);
        stored.set(light, id);
      }
      return surrounding ? sh : undefined;
    },
  };
}
