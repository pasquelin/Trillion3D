// The viewpoint and the sun the shadow-plan tests share: an eye five units up looking down -Z, a
// sun straight overhead that casts.
import type { SceneLight, ShadowViewpoint } from '../light/contracts.ts';

export const VIEW: ShadowViewpoint = {
  position: [0, 5, 0],
  forward: [0, 0, -1],
  halfFovY: 0.6,
  aspect: 16 / 9,
  near: 0.1,
  far: 200,
};

export const SUN: SceneLight = {
  id: 'sun',
  kind: 'directional',
  direction: [0, -1, 0],
  color: [1, 1, 1],
  intensity: 1,
  castsShadow: true,
};
