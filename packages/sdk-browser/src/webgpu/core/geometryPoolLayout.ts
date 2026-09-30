import { COLOR_FLOATS, UV_FLOATS, colorFloatAt, uvBufferFloats } from './vertexColors.ts';

/** How each list a pool block carries is laid out: its buffer, its floats per vertex, and the
 *  host lists it is written from, each with its width and the value of a missing component — a
 *  normal and a tangent share seven floats a vertex, a colour rides at the tail of the UVs, the
 *  normals after the positions in their buffer (`poolRegions`). */
// prettier-ignore
export const LAYOUT = {
  position: { buffer: 'concatPos', stride: 3, parts: [['position', 3, 0]] },
  uv: { buffer: 'concatUv', stride: UV_FLOATS, parts: [['uv', UV_FLOATS, 0]] },
  color: { buffer: 'concatUv', stride: COLOR_FLOATS, parts: [['color', COLOR_FLOATS, 1]] },
  normal: { buffer: 'concatPos', stride: 7, parts: [['normal', 3, 0], ['tangent', 4, 0]] },
} as const;
export type PoolList = keyof typeof LAYOUT;
export const LISTS = Object.keys(LAYOUT) as PoolList[],
  BUFFERS = ['concatPos', 'concatUv'] as const;
export type BufferKey = (typeof BUFFERS)[number];
export type Buffers<T> = Record<BufferKey, T>;

/** Floats between two binding offsets of a storage buffer: the device's alignment, never under
 *  the 256 bytes WebGPU guarantees. */
export const storageOffsetFloats = (limits?: { minStorageBufferOffsetAlignment?: number }) =>
  Math.max(256, limits?.minStorageBufferOffsetAlignment ?? 256) / 4;

/**
 * Where a pool of `count` vertices keeps each region, in floats (#1410). The position buffer holds
 * the positions, the deformation block after them (`tail`), then, from the first binding offset
 * past it (`align`), every normal and its tangent: a pass that reads positions and normals — the
 * shadow receiver offset — binds the buffer once, the others bind the two ranges they always read.
 * The UV buffer holds the UVs and their colour tail.
 */
export function poolRegions(count: number, tail: number, coloured: boolean, align: number) {
  const normalStart = Math.ceil((count * 3 + tail) / align) * align;
  const floats: Buffers<number> = {
    concatPos: normalStart + count * 7,
    concatUv: uvBufferFloats(count, coloured),
  };
  /** The float of `name`'s buffer vertex `vertex` starts at. */
  const offsetOf = (name: PoolList, vertex: number) =>
    name === 'color'
      ? colorFloatAt(count, vertex)
      : (name === 'normal' ? normalStart : 0) + vertex * LAYOUT[name].stride;
  return { count, tail, coloured, normalStart, floats, offsetOf };
}
export type PoolRegions = ReturnType<typeof poolRegions>;

/** What a growth from `from` to `to` copies in buffer `key`, in floats: `[source, destination,
 *  count]` per region — the vertices, the deformation block, the normals, the colour tail. */
export function growthCopies(
  key: BufferKey,
  from: PoolRegions,
  to: PoolRegions,
): [number, number, number][] {
  const { count, tail, coloured } = from;
  if (key === 'concatPos')
    return [
      [0, 0, count * 3],
      [count * 3, to.count * 3, tail],
      [from.normalStart, to.normalStart, count * 7],
    ];
  return coloured
    ? [
        [0, 0, count * UV_FLOATS],
        [from.offsetOf('color', 0), to.offsetOf('color', 0), count * COLOR_FLOATS],
      ]
    : [[0, 0, count * UV_FLOATS]];
}
