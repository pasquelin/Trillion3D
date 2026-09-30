import { coneContextFor, coneCullsPageWith, createConeContext, type NormalCone } from './cone.ts';
import type { PageSurface } from '../surface.ts';
import type { MatrixElements } from '../../math/matrixElements.ts';

const loneContext = createConeContext();

/** Same culling for a caller without context: sets one for this single cluster. */
export function coneCullsPage(
  cone: NormalCone,
  world: MatrixElements,
  min: number[],
  max: number[],
  eye: ArrayLike<number>,
  surface?: PageSurface,
): boolean {
  return coneCullsPageWith(coneContextFor(loneContext, world, eye), cone, world, min, max, surface);
}
