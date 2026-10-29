import { mipCountOf, mipVolumeResolution, voxelCountOf, voxelListBytes } from './sparseVoxelPlan.ts'

type Vec3 = readonly [number, number, number]

/** The words of the header of the buffer of the boxes: the levels, where the leaf boxes begin, the volume's resolution, the offset of each level. */
export const BOX_HEADER_WORDS = 20
/** The most levels the header holds an offset for (a side of 1024 voxels has eleven). */
export const BOX_MAX_LEVELS = 12
/** The bytes the offset of a binding of the buffer is a multiple of. */
const BINDING_ALIGN_WORDS = 64

/** The side of a level of the hierarchy: the volume's cut in halves, held up to the cell that covers its edge, never under one. */
export const boxLevelResolution = (resolution: Vec3, level: number): [number, number, number] =>
  resolution.map((n) => Math.max(Math.ceil(n / 2 ** level), 1)) as [number, number, number]

/** The levels the hierarchy of a volume has: down to a single node over the whole volume. */
export const boxLevelCount = (resolution: Vec3) =>
  Math.ceil(Math.log2(Math.max(...resolution, 1))) + 1

const alignWords = (n: number) => Math.ceil(n / BINDING_ALIGN_WORDS) * BINDING_ALIGN_WORDS

/**
 * The layout of the buffer of the boxes of a volume of `resolution` voxels whose sparse voxels start at mip `bias`: the header, the nodes of the
 * levels from `bias` up (a word each: 0 empty, 0x80000000 with a leaf below it, else a leaf holding its voxel's place in the list plus one), then, at an offset a binding can start at, six floats for each of at most `capacity`
 * leaf boxes.
 */
export function boxLayout(resolution: Vec3, bias: number, capacity: number) {
  const levels = boxLevelCount(resolution)
  const offsets: number[] = []
  let at = BOX_HEADER_WORDS
  for (let level = 0; level < levels; level++) {
    offsets.push(level < bias ? 0 : at)
    if (level >= bias) at += voxelCountOf(boxLevelResolution(resolution, level))
  }
  const positions = alignWords(at)
  return { levels, offsets, nodesEnd: at, positions, words: positions + capacity * 6 }
}

/** The header the build and the walk read: levels, the leaf boxes' offset, the resolution, each level's offset. */
export function boxHeader(resolution: Vec3, layout: ReturnType<typeof boxLayout>) {
  const out = new Uint32Array(BOX_HEADER_WORDS)
  out.set([layout.levels, layout.positions, ...resolution], 0)
  out.set(layout.offsets, 5)
  return out
}

/**
 * The mip the sparse voxels are made at: the requested bias, raised until the buffers of the voxels and of the boxes fit the largest binding of
 * the device (`maxBytes`), never past the last level of the volume's chain.
 */
export function fitSparseVoxelBias(resolution: Vec3, requested: number, maxBytes: number) {
  const last = mipCountOf(resolution) - 1
  for (let bias = Math.min(requested, last); bias < last; bias++) {
    const min = mipVolumeResolution(resolution, bias)
    const boxes = boxLayout(resolution, bias, voxelCountOf(min)).words * 4
    if (voxelListBytes(min) <= maxBytes && boxes <= maxBytes) return bias
  }
  return last
}
