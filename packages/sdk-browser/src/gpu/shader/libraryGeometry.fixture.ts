// The triangle, plane and ray declarations of the maths library
// (`packages/math/src/wgsl/geometry.ts`), their shipped text run in JavaScript, and the seeded draws
// their tests feed it (`libraryGeometry.test.ts`, `libraryRays.test.ts`).
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import {
  boxBehindPlane,
  faceNormal,
  rayBoxEntry,
  rayInverseDirection,
  raySegmentDistance,
  rayTriangleDistance,
  sinFromCos,
  sinFromCosUnclamped,
  sphereBehindPlane,
  vectorRejection,
} from '../../../../math/src/wgsl/geometry.ts'
export type V = number[]
/** `n` draws of the seeded sequence, in [-1, 1). */
export const take = (rand: () => number, n: number) =>
  Array.from({ length: n }, () => 2 * rand() - 1)

export const run = shaderRun<Record<string, (...args: never[]) => never>>(
  wgslModule(
    faceNormal,
    vectorRejection,
    sinFromCos,
    sinFromCosUnclamped,
    boxBehindPlane,
    sphereBehindPlane,
    rayInverseDirection,
    rayBoxEntry,
    rayTriangleDistance,
    raySegmentDistance,
  ),
  [
    'faceNormal',
    'vectorRejection',
    'sinFromCos',
    'sinFromCosUnclamped',
    'planeDistance',
    'boxPositiveVertex',
    'boxPlaneDistance',
    'boxBehindPlane',
    'sphereBehindPlane',
    'rayInverseDirection',
    'rayBoxEntry',
    'rayTriangleDistance',
    'raySegmentDistance',
  ],
  {},
) as unknown as Record<string, (...args: unknown[]) => unknown>
