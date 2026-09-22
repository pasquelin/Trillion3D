import { Box3 } from '../../../sdk-core/world/math/box3.ts';
import { Vector3 } from '../../../sdk-core/world/math/vector3.ts';
import type { Light } from '../../../sdk-core/world/light/light.ts';
import { addLightIrradiance, lampRecord } from '../../../sdk-core/world/light/lightRecord.ts';
import type { Object3D } from '../../../sdk-core/world/object/object3d.ts';
import { emptyIrradiance, type SceneLight } from '../../../sdk-core/index.ts';
import { sameSceneLight } from '../../../sdk-core/sceneLightEqual.ts';

/** The light calls of a session (`explorerLightApi.ts`) the world writes its lights through. */
type LightApi = {
  addLight(light: SceneLight): void;
  setLight(id: string, patch: Partial<Omit<SceneLight, 'id'>>): void;
  removeLight(id: string): void;
};

const eye = new Vector3();

export const isLight = (node: Object3D) => (node as { isLight?: boolean }).isLight === true;

/** True when `node` is a light or one hangs under it: moving the node moves the light. */
export function lightsUnder(node: Object3D): boolean {
  return isLight(node) || node.children.some(lightsUnder);
}

/** The same optional members, so a patch of `next` over `last` leaves none of `last`'s behind. */
const sameKeys = (last: SceneLight, next: SceneLight) => {
  const keys = Object.keys(next);
  return keys.length === Object.keys(last).length && keys.every((key) => key in last);
};

/**
 * Keeps a session's light store equal to the lights of a scene. A light the page left unbounded
 * reaches the farthest corner of what the scene holds, seen from where it stands: the range is
 * derived from the scene's own extent, never picked. That extent is measured again only after
 * something in the scene moved or changed (`boundsMoved`).
 */
export function createWorldLights() {
  const stored = new Map<Light, { id: string; record: SceneLight }>();
  const bounds = new Box3();
  let next = 1,
    boundsStale = true,
    held = 0;
  const reach = (light: Light) => {
    light.getWorldPosition(eye);
    const { min, max } = bounds;
    const dx = Math.max(Math.abs(min.x - eye.x), Math.abs(max.x - eye.x)),
      dy = Math.max(Math.abs(min.y - eye.y), Math.abs(max.y - eye.y)),
      dz = Math.max(Math.abs(min.z - eye.z), Math.abs(max.z - eye.z));
    const far = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return Number.isFinite(far) && far > 0 ? far : 1;
  };
  return {
    /** The session changed: its store starts empty. */
    reset() {
      stored.clear();
      boundsStale = true;
    },
    /** Something that may hold content moved or changed: the extent is measured at the next sync. */
    boundsMoved() {
      boundsStale = true;
    },
    /** How many lights the scene held at the last sync. */
    get held() {
      return held;
    },
    /** Writes the lamps into the store and returns what every other light gives from every
     *  direction — ambient, sky over ground, probe — as the environment's irradiance, or
     *  undefined when none gives any. */
    sync(scene: Object3D, api: LightApi): number[] | undefined {
      const lights = new Set<Light>();
      const sh = emptyIrradiance();
      let surrounding = false;
      scene.traverse((node) => {
        if (!isLight(node)) return;
        lights.add(node as Light);
        if (addLightIrradiance(node as Light, sh)) surrounding = true;
      });
      held = lights.size;
      if (boundsStale) bounds.setFromObject(scene);
      boundsStale = false;
      const drop = (light: Light, id: string) => {
        api.removeLight(id);
        stored.delete(light);
      };
      for (const [light, { id }] of stored) if (!lights.has(light)) drop(light, id);
      for (const light of lights) {
        const last = stored.get(light);
        const id = last?.id ?? `world-light-${next++}`;
        const record = lampRecord(light, id, reach(light));
        if (!record) {
          if (last) drop(light, id);
          continue;
        }
        if (last && sameSceneLight(last.record, record)) continue;
        // A lamp keeping its members is written in its slot; one gaining or losing one is
        // written anew, so no member of its former record survives.
        if (last && sameKeys(last.record, record)) api.setLight(id, record);
        else {
          if (last) api.removeLight(id);
          api.addLight(record);
        }
        stored.set(light, { id, record });
      }
      return surrounding ? sh : undefined;
    },
  };
}
