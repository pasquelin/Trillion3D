import {
  reflectionCaptureCentre,
  reflectionCaptureRadius,
  reflectionCaptureScales,
  type ResolvedReflectionCapture,
} from '../../../../sdk-core/src/scene/reflectionCapture/contracts.ts'
import {
  CAPTURE_BLOCK_WORDS,
  CAPTURE_HEADER_WORDS,
  CAPTURE_RECORD_WORDS,
  CAPTURE_SHAPE_CODE,
  MAX_REFLECTION_CAPTURES,
} from './layout.ts'

/**
 * THE CAPTURES' RECORDS, as the lighting reads them (`compositeWgsl.ts`): the captures in the order the composite reads them, packed with
 * the cube array layer each was captured into.
 */

/** The captures ordered the way they are composited: the smallest reach first, so that the small ones show over the large; two of a
 *  reach by their name, which stands for the reference's hash of the path. The sky light takes what none covers. */
export const reflectionCaptureSorted = (captures: Iterable<ResolvedReflectionCapture>) =>
  [...captures]
    .sort(
      (a, b) =>
        reflectionCaptureRadius(a) - reflectionCaptureRadius(b) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, MAX_REFLECTION_CAPTURES)

/** The columns of the matrix that takes a world vector to the box's frame, where the box is at plus and minus one: the inverse of the
 *  capture's matrix without its translation, scale included. The matrix is a rotation times a scale, so the inverse is the transpose of its
 *  columns each divided by the square of its length. */
function worldToBoxColumns(matrix: readonly number[]) {
  const axis = (at: number) => {
    const x = matrix[at],
      y = matrix[at + 1],
      z = matrix[at + 2]
    const square = x * x + y * y + z * z
    return [x / square, y / square, z / square] as const
  }
  const [a, b, c] = [axis(0), axis(4), axis(8)]
  // Row i of the inverse is axis i; the columns of the inverse are therefore the components across the three rows.
  return [
    [a[0], b[0], c[0]],
    [a[1], b[1], c[1]],
    [a[2], b[2], c[2]],
  ] as const
}

/**
 * The block of `captures` (already sorted), written into `out` (`CAPTURE_BLOCK_WORDS` floats): the header — how many, the cube's last mip,
 * whether the diffuse light is read — then a record each: the centre and the reach; the brightness, the cube array layer (`layers`, by
 * name), the shape and a spare 1; the capture offset; the three columns of the world-to-box
 * matrix; the box's half extents and transition distance.
 */
export function packReflectionCaptures(
  out: Float32Array,
  captures: readonly ResolvedReflectionCapture[],
  layers: ReadonlyMap<string, number>,
  lastMip: number,
  diffuse: boolean,
) {
  if (out.length < CAPTURE_BLOCK_WORDS)
    throw new RangeError('the block is too small for the captures')
  out.fill(0)
  out.set([captures.length, lastMip, diffuse ? 1 : 0, 0])
  captures.forEach((capture, i) => {
    const at = CAPTURE_HEADER_WORDS + i * CAPTURE_RECORD_WORDS
    const box = capture.shape === 'box'
    const columns = worldToBoxColumns(capture.matrix)
    out.set([...reflectionCaptureCentre(capture), reflectionCaptureRadius(capture)], at)
    out.set(
      [capture.brightness, layers.get(capture.id) ?? 0, CAPTURE_SHAPE_CODE[capture.shape], 1],
      at + 4,
    )
    out.set(capture.captureOffset, at + 8)
    if (box) {
      columns.forEach((column, k) => out.set(column, at + 12 + 4 * k))
      out.set([...reflectionCaptureScales(capture), capture.boxTransitionDistance], at + 24)
    }
  })
  return out
}
