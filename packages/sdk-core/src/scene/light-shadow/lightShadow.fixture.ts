// The sun the shadow tests share: straight overhead, and it casts.
import type { SceneLight } from '../light/contracts.ts'

export const SUN: SceneLight = {
  id: 'sun',
  kind: 'directional',
  direction: [0, -1, 0],
  color: [1, 1, 1],
  intensity: 1,
  castsShadow: true,
}
