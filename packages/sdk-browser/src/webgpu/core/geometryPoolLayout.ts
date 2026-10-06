import { storageBufferCap } from '../../residency/pools.ts'
import { COLOR_FLOATS, UV_FLOATS, colorFloatAt, uvBufferFloats } from './vertexColors.ts'
import { floatAtlasFits } from './floatAtlas.ts'

/** How each list a pool block carries is laid out: its store, its floats per vertex, and the
 *  host lists it is written from, each with its width and the value of a missing component — a
 *  normal and a tangent share seven floats a vertex in the normal atlas (`floatAtlas.ts`),
 *  a colour rides at the tail of the UVs. */
// prettier-ignore
export const LAYOUT = {
  position: { buffer: 'concatPos', stride: 3, parts: [['position', 3, 0]] },
  uv: { buffer: 'concatUv', stride: UV_FLOATS, parts: [['uv', UV_FLOATS, 0]] },
  color: { buffer: 'concatUv', stride: COLOR_FLOATS, parts: [['color', COLOR_FLOATS, 1]] },
  normal: { buffer: 'concatNrm', stride: 7, parts: [['normal', 3, 0], ['tangent', 4, 0]] },
} as const
export type PoolList = keyof typeof LAYOUT
export const LISTS = Object.keys(LAYOUT) as PoolList[],
  BUFFERS = ['concatPos', 'concatUv'] as const
export type BufferKey = (typeof BUFFERS)[number]
/** The pool's stores: its two storage buffers and its normal atlas. */
export type Stores<T> = Record<BufferKey | 'concatNrm', T>

/** Floats of each store of a pool of `count` vertices, the deformation block (`tail`) after the
 *  positions, the colour tail after the UVs. */
export const poolFloats = (count: number, tail: number, coloured: boolean): Stores<number> => ({
  concatPos: count * 3 + tail,
  concatUv: uvBufferFloats(count, coloured),
  concatNrm: count * 7,
})

/** Whether a device of `limits` holds the stores of `floats`: each buffer under the storage
 *  binding cap, the normals within the texture limits. */
export const poolFits = (floats: Stores<number>, limits?: GPUSupportedLimits) =>
  BUFFERS.every((key) => floats[key] * 4 <= storageBufferCap(limits)) &&
  floatAtlasFits(floats.concatNrm, limits)

/** The float of `name`'s store vertex `vertex` starts at, in a pool of `count` vertices: in the
 *  UVs' tail for a colour. */
export const offsetOf = (name: PoolList, count: number, vertex: number) =>
  name === 'color' ? colorFloatAt(count, vertex) : vertex * LAYOUT[name].stride

/** What a growth of `from` vertices to `to` copies in buffer `key`, in floats: `[source,
 *  destination, count]` per region — the vertices, the colour tail when the UVs carry one, and
 *  the deformation block. The normal atlas is written again from its geometries (`geometryPool.ts`). */
export function growthCopies(
  key: BufferKey,
  from: number,
  to: number,
  tail: number,
  coloured: boolean,
): [number, number, number][] {
  if (key === 'concatPos')
    return tail
      ? [
          [0, 0, from * 3],
          [from * 3, to * 3, tail],
        ]
      : [[0, 0, from * 3]]
  return coloured
    ? [
        [0, 0, from * UV_FLOATS],
        [from * UV_FLOATS, to * UV_FLOATS, from * COLOR_FLOATS],
      ]
    : [[0, 0, from * UV_FLOATS]]
}
