import type { DrawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts'
import { drawnKind } from '../../../../sdk-core/src/world/geometry/drawnKind.ts'

/** The words before the arrays: five lengths, whether they are faces, whether a blended material
 *  wears them, then a deformation's influences and targets. */
const HEADER_WORDS = 9
const drawnFaces = (d: DrawnTriangles) => drawnKind(d) === 'faces'

/** Drawn triangles as one buffer: its header (`HEADER_WORDS`), then the five arrays, every one
 *  four-byte wide. `blended` is part of the content: its pages sit on a finer grid. Faces have
 *  area: they alone take the spatial clusters and a proxy (`cutDrawnTriangles`). */
export function packDrawn(drawn: DrawnTriangles, blended: boolean): ArrayBuffer {
  const parts = [drawn.positions, drawn.normals, drawn.uvs, drawn.colors, drawn.indices]
  const deformation = drawn.deformation
  if (deformation?.joints && deformation.weights)
    parts.push(deformation.joints, deformation.weights)
  for (const target of deformation?.targets ?? []) parts.push(target.positions, target.normals)
  const lengths = parts.map((part) => part?.length ?? 0)
  const packed = new Uint32Array(HEADER_WORDS + lengths.reduce((a, b) => a + b, 0))
  packed.set([...lengths.slice(0, 5), Number(drawnFaces(drawn)), Number(blended)])
  packed[7] = deformation?.joints && deformation.weights ? (deformation.influences ?? 4) : 0
  packed[8] = deformation?.targets.length ?? 0
  let at = HEADER_WORDS
  for (const part of parts)
    if (part) {
      packed.set(new Uint32Array(part.buffer, part.byteOffset, part.length), at)
      at += part.length
    }
  return packed.buffer
}

/** The triangles `packDrawn` wrote, as views on its buffer, whether they are faces and whether a
 *  blended material wears them. */
export function unpackDrawn(buffer: ArrayBuffer): {
  drawn: DrawnTriangles
  faces: boolean
  blended: boolean
} {
  const header = new Uint32Array(buffer, 0, HEADER_WORDS),
    faces = header[5] === 1,
    blended = header[6] === 1
  let at = header.byteLength
  const take = <T>(make: (b: ArrayBuffer, offset: number, length: number) => T, i: number) => {
    const view = header[i] ? make(buffer, at, header[i]) : null
    at += header[i] * 4
    return view
  }
  const float = (b: ArrayBuffer, offset: number, length: number) =>
    new Float32Array(b, offset, length)
  const words = (b: ArrayBuffer, offset: number, length: number) =>
    new Uint32Array(b, offset, length)
  const drawn: DrawnTriangles = {
    positions: take(float, 0)!,
    // Triangles without normals carry none: their pages have none either.
    normals: take(float, 1) ?? new Float32Array(0),
    uvs: take(float, 2),
    colors: take(float, 3),
    indices: take(words, 4)!,
  }
  const vertices = drawn.positions.length / 3
  const list = (length: number) => {
    const view = new Float32Array(buffer, at, length)
    at += length * 4
    return view
  }
  if (header[7] || header[8])
    drawn.deformation = {
      ...(header[7]
        ? {
            joints: list(vertices * header[7]),
            weights: list(vertices * header[7]),
            influences: header[7],
          }
        : {}),
      targets: Array.from({ length: header[8] }, () => ({
        positions: list(vertices * 3),
        normals: list(vertices * 3),
      })),
    }
  return { drawn, faces, blended }
}
