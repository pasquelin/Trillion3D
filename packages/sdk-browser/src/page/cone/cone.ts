import { surfaceFrontOnly, type PageSurface } from '../surface.ts'

export type NormalCone = { axis: [number, number, number]; angle: number }
/** Never rejects. */
export const OPEN_CONE: NormalCone = { axis: [0, 0, 1], angle: Math.PI }

/** The cone a leaf is culled by: none for a surface seen from both sides. */
export function leafCone(page: { cone?: NormalCone; material?: PageSurface }): NormalCone {
  if (page.material && !surfaceFrontOnly(page.material)) return OPEN_CONE
  return page.cone ?? OPEN_CONE
}
