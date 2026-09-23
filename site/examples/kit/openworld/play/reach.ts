import { H, REACH, spawnsOf, type Layout } from './protocol.ts';
import type { Marker } from './types.ts';

/**
 * What the E key would do where the walker stands, as the HUD says it: the same reach the
 * simulation uses, to the player's own vehicle or to one parked at a spawn.
 */
export function vehicleAt(
  snapshot: { next: Float32Array },
  layout: Layout,
  markers: readonly Marker[],
  at: readonly number[],
): string | null {
  const { next } = snapshot;
  const words = { car: 'E — drive the car', plane: 'E — fly the plane' } as const;
  for (const kind of ['car', 'plane'] as const) {
    const taken = next[kind === 'car' ? H.carSpawn : H.planeSpawn];
    const block = kind === 'car' ? layout.car : layout.plane;
    const near = (x: number, z: number) => Math.hypot(x - at[0], z - at[2]) < REACH[kind];
    if (taken >= 0 && near(next[block] + next[H.originX], next[block + 2] + next[H.originZ]))
      return words[kind];
    const spawns = spawnsOf(markers, kind);
    if (spawns.some((s, i) => i !== taken && near(s.position[0], s.position[2])))
      return words[kind];
  }
  return null;
}
