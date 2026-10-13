import type { DrawnTriangles } from './drawn.ts'

/** What tells the kind of drawn triangles (`DrawnTriangles`). */
export type DrawnShape = Pick<DrawnTriangles, 'lines' | 'spriteRadius'>

/** What drawn triangles are: faces, line quads (`lines`) or a sprite's quad (`spriteRadius`). Line
 *  quads are widened and a sprite's quad turned to the camera: neither shares a resource, a cone or
 *  a surface with the same bytes read as faces. */
export const drawnKind = (drawn: DrawnShape) =>
  drawn.lines ? 'lines' : drawn.spriteRadius !== undefined ? 'sprite' : 'faces'

/** The box and ball a sprite's quad is bounded by: the cube and ball of its radius about its origin,
 *  which hold it whichever way the rasters turn it. `undefined` for any other kind, bounded by
 *  its own corners. */
export function drawnBounds(drawn: DrawnShape) {
  const radius = drawn.spriteRadius
  if (radius === undefined) return undefined
  return {
    min: [-radius, -radius, -radius],
    max: [radius, radius, radius],
    sphere: [0, 0, 0, radius],
  }
}
