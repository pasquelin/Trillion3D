// The detached copy the public light API hands out; kept beside the contract it copies.
import type { SceneLight } from './sceneLightContracts.ts';
/**
 * A detached copy of a light, arrays included. What the public API hands out is one of these:
 * a host that writes into the copy it received changes nothing in the engine, and a host that
 * mutates a light it has already submitted changes nothing either — the store validated its
 * own copy on the way in. The copy is made where the host reads, never on the frame path:
 * engines read the held record and the packed buffer, and copy nothing.
 */
export function cloneSceneLight(light: SceneLight): SceneLight {
  const copy: SceneLight = { ...light, color: [...light.color] };
  if (light.position) copy.position = [...light.position];
  if (light.direction) copy.direction = [...light.direction];
  if (light.right) copy.right = [...light.right];
  if (light.size) copy.size = [...light.size];
  return copy;
}
