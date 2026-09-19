import type * as THREE from 'three';
import { MATRIX_VALUES } from '../sdk-core/index.ts';
import { hostWorldChainInto } from './hostWorldChain.ts';

/** Slots reserved for a light: colour, intensity, range, decay, cone, ground, and the world
 *  position of its target when it has one. A fixed slot, like a node's. */
export const LIGHT_SLOTS = 14;

const finite = (value: number | undefined) => (Number.isFinite(value) ? (value as number) : 0);
const scratch = new Float64Array(LIGHT_SLOTS);
/** Target's world matrix, computed by the engine: only its translation is reread. */
const targetWorld = new Float64Array(MATRIX_VALUES);

/**
 * Rereads the numbers of a light that engines consume, whatever its type, and compares them to
 * what is held at `at`. A property a type does not carry is zero: the slot is the same for every
 * light, and the calling loop has nothing to measure.
 *
 * The target of a directional or cone light carries its direction and often lives outside the
 * source graph: its world position is COMPUTED here, with the light, and never by the walk. The
 * engine itself walks the target's ancestor chain from their local poses (`hostWorldChain.ts`)
 * instead of asking the host to resolve it, and writes nothing into its scene.
 */
export function readLightInto(light: THREE.Light, held: Float64Array, at: number) {
  const shaped = light as THREE.Light & {
    distance?: number;
    decay?: number;
    angle?: number;
    penumbra?: number;
    groundColor?: THREE.Color;
    target?: THREE.Object3D;
  };
  scratch[0] = light.color.r;
  scratch[1] = light.color.g;
  scratch[2] = light.color.b;
  scratch[3] = light.intensity;
  scratch[4] = finite(shaped.distance);
  scratch[5] = finite(shaped.decay);
  scratch[6] = finite(shaped.angle);
  scratch[7] = finite(shaped.penumbra);
  const ground = shaped.groundColor;
  scratch[8] = ground ? ground.r : 0;
  scratch[9] = ground ? ground.g : 0;
  scratch[10] = ground ? ground.b : 0;
  const target = shaped.target;
  if (target) {
    hostWorldChainInto(targetWorld, target);
    scratch[11] = targetWorld[12];
    scratch[12] = targetWorld[13];
    scratch[13] = targetWorld[14];
  } else scratch[11] = scratch[12] = scratch[13] = 0;
  let moved = false;
  for (let k = 0; k < LIGHT_SLOTS; k++)
    if (held[at + k] !== scratch[k]) {
      held[at + k] = scratch[k];
      moved = true;
    }
  return moved;
}
