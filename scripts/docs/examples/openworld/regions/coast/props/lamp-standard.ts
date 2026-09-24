/**
 * The cast-iron lamp standard of the pier and the quay, and its light in the frame of the prop
 * that carries it.
 */
import type { MeshPart } from '../../../plan/contract.ts';
import { cylinder, lathe, SURFACES, transform, type PropLamp } from '../../../props/index.ts';
import { COAST } from '../surfaces.ts';

/** A cast-iron lamp standard 4 m high, lantern at the top. */
export function lampStandard(x: number, z: number): MeshPart[] {
  return [
    transform(
      lathe(
        SURFACES.darkMetal,
        [
          [0.14, 0],
          [0.1, 0.4],
          [0.06, 0.6],
          [0.05, 3.6],
          [0.1, 3.7],
        ],
        { segments: 10 },
      ),
      { at: [x, 0, z] },
    ),
    transform(cylinder(COAST.lanternGlass, 0.18, 0.45, { segments: 8, top: 0.24 }), {
      at: [x, 3.7, z],
    }),
    transform(cylinder(SURFACES.emissiveLamp, 0.08, 0.3, { segments: 8 }), { at: [x, 3.75, z] }),
    transform(cylinder(SURFACES.darkMetal, 0.28, 0.25, { segments: 8, top: 0.02 }), {
      at: [x, 4.15, z],
    }),
  ];
}

/** A lamp's light in its bay's frame: a warm point at the lantern, lit at night. */
export const lampAt = (id: string, x: number, z: number): PropLamp => ({
  id,
  type: 'point',
  offset: [x, 3.85, z],
  color: [1, 0.8, 0.55],
  intensity: 150,
  range: 18,
  night: true,
});
