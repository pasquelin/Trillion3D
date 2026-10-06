// The outputs the equivalence lines' engine side writes, one per element, allocated here once and
// never under the clock (`coreEquivalence.ts`): a timed side that allocated its result per element
// measured the allocator as much as the foundation.
import { outputs, trsOutputs } from './coreLine.ts'
import { affines, matrices, pairs, pairs32, points } from './scenesCore.ts'

/** The points each matrix is crossed with. */
export const samplePoints = points.filter((_, i) => i % 29 === 0)
/** Each matrix against each sample point, listed once, as the timed side walks them. */
const crossing = (list: Float64Array[]) =>
  list.flatMap((m) => samplePoints.map((p) => [m, p] as const))
export const [affineCrossings, matrixCrossings] = [crossing(affines), crossing(matrices)]
export const [products, inPlace] = [outputs(pairs.length, 16), outputs(pairs.length, 16)]
export const [toSingle, inverses] = [outputs(pairs32.length, 16), outputs(matrices.length, 16)]
export const singles = Array.from({ length: pairs32.length }, () => new Float32Array(16))
export const normals = outputs(matrices.length, 9),
  determinants = new Float64Array(matrices.length)
export const [decomposed, displaced] = [trsOutputs(matrices.length), trsOutputs(pairs.length)]
export const affinePointsOut = outputs(affineCrossings.length, 3),
  clips = outputs(matrixCrossings.length, 4)
/** Each cross product and dot product, as the reference side returns them. */
export const crossDots = outputs(points.length, 3).map((c): (Float64Array | number)[] => [c, 0])
export const [rests, poses] = [outputs(pairs.length, 16), outputs(pairs.length, 16)]
