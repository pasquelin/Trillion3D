import type { VsmProjectionLight } from './projectionPass.ts'

/** The identity view under a perspective projection, and one sun straight down: what the
 *  projection pass tests encode their frames with. */
export const camera = {
  view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  projection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0.1, 0],
  perspective: true,
}
export const sun: VsmProjectionLight = {
  type: 'directional',
  mapId: 0,
  direction: [0, -1, 0],
}
