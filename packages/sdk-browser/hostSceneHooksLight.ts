import type * as THREE from 'three';
import { accessor, bump, hookTriple, RGB, type Hook } from './hostSceneHookCore.ts';

/** Numbers of a light the engines consume, when its type carries them. */
const LIGHT_NUMBERS = ['intensity', 'distance', 'decay', 'angle', 'penumbra'] as const;

export type HookedLight = THREE.Light & {
  distance?: number;
  decay?: number;
  angle?: number;
  penumbra?: number;
  groundColor?: THREE.Color;
  target?: THREE.Object3D;
};

export function hookLight(light: HookedLight, hook: Hook) {
  const written = () => bump(hook);
  for (const key of LIGHT_NUMBERS) if (key in light) accessor(light, key, hook, written);
  // A colour replaced as a whole is hooked in turn: what the host writes into it afterwards
  // must still be seen.
  for (const key of ['color', 'groundColor'] as const) {
    const colour = light[key];
    if (!colour) continue;
    hookTriple(colour, RGB, hook);
    accessor(light, key, hook, (next) => {
      if (next) hookTriple(next, RGB, hook);
      bump(hook);
    });
  }
  // A new target is another chain of ancestors to watch: the set is reshaped.
  if ('target' in light) accessor(light, 'target', hook, () => bump(hook, true));
}
