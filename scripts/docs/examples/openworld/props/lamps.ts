/**
 * Lamps a prop carries, declared in the prop's own frame. A region places the prop, then calls
 * `placeLamps` with the same instance: the lights follow the instance's position, yaw and scale,
 * and reach the cache's `lights.json` through the glTF writer.
 */
import type { Instance, LampLight, Vec3 } from '../plan/contract.ts';
import { applyPoint, trsMatrix } from './transform.ts';

/** A lamp in its prop's frame: `offset` from the prop's origin, `direction` in the prop's axes. */
export type PropLamp = Omit<LampLight, 'name' | 'position'> & { id: string; offset: Vec3 };

/** The prop's lamps in world space for one placed instance, named `<name>/<lamp id>`. */
export function placeLamps(
  lamps: readonly PropLamp[],
  instance: Instance,
  name = instance.name ?? instance.prop,
): LampLight[] {
  const place = trsMatrix({ at: instance.position, yaw: instance.yaw, scale: instance.scale }),
    turn = trsMatrix({ yaw: instance.yaw });
  return lamps.map(({ id, offset, direction, ...light }) => ({
    ...light,
    name: `${name}/${id}`,
    position: applyPoint(place, offset),
    ...(direction ? { direction: applyPoint(turn, direction) } : {}),
  }));
}

/** Warm white of a sodium-free LED street lamp, linear RGB. */
const WARM: Vec3 = [1, 0.82, 0.62];

/**
 * A street lamp's light: a downward spot from the lamp head. About 10 000 lm into a 57° half
 * cone (π sr) gives ≈ 3 000 cd; the range is where it falls under a street's lighting floor.
 */
export const STREET_LAMP_LIGHTS: readonly PropLamp[] = [
  {
    id: 'lamp',
    type: 'spot',
    offset: [1.55, 7.75, 0],
    direction: [0, -1, 0],
    cone: 1,
    color: WARM,
    intensity: 3000,
    range: 32,
    night: true,
  },
];
