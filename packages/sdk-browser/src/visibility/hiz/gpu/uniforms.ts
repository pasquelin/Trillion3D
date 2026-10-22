import { uniformSlots } from '../../../session/memory/pools.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'

/** The deepest pyramid the camera builds. */
export const HIZ_MAX_LEVELS = 16
/** Mips one build pass reduces in workgroup memory: an 8 × 8 workgroup reduces a 16 × 16 source
 *  tile down to one texel. */
export const HIZ_PASS_LEVELS = 4
/** Threads per side of a build workgroup: each reduces one 2 × 2 square, and the workgroup
 *  halves them `HIZ_PASS_LEVELS - 1` more times down to one texel. */
export const HIZ_BUILD_SIDE = 1 << (HIZ_PASS_LEVELS - 1)
/** A slot's struct `Uni` (`shader.ts`): a build pass's header — its source level, then `upper`,
 *  `front` and `planes` — and one `vec4u` per level it writes, aligned as WGSL aligns it. */
export const HIZ_UNI = fieldLayout('Uni', [
  ['a', 'u32'],
  ['b', 'u32'],
  ['c', 'u32'],
  ['d', 'u32'],
  ['upper', 'u32'],
  ['front', 'u32'],
  ['planes', 'u32'],
  ['dst', { wgsl: `array<vec4u,${HIZ_PASS_LEVELS}>`, words: 4 * HIZ_PASS_LEVELS, align: 4 }],
])
/** Words a slot holds: a build pass's header and the levels it writes; its other words up to the
 *  device's alignment are never written. */
export const HIZ_SLOT_WORDS = HIZ_UNI.words

/** The Hi-Z's uniform slots on a device of `limits`: the deepest pyramid's build passes. */
export const hizUniformSlots = (limits?: Parameters<typeof uniformSlots>[0]) =>
  uniformSlots(limits, ceilDiv(HIZ_MAX_LEVELS - 1, HIZ_PASS_LEVELS), HIZ_SLOT_WORDS)

/** One build pass: the level it reads, its size, and the count of levels it writes. */
export type HizBuildPass = { source: number; width: number; height: number; levels: number }

/**
 * The build passes of a pyramid of `sizes`, at most `maxLevels` deep: each pass reads one level
 * and reduces the next `HIZ_PASS_LEVELS` from it through workgroup memory. The first reads the
 * level-0 texture, copying it into the pyramid on the way, even when there is nothing to reduce.
 */
export function hizBuildPasses(sizes: Array<[number, number]>, maxLevels = HIZ_MAX_LEVELS) {
  const last = Math.min(sizes.length, maxLevels) - 1
  const passes: HizBuildPass[] = []
  let source = 0
  do {
    const [width, height] = sizes[source]
    passes.push({ source, width, height, levels: Math.min(HIZ_PASS_LEVELS, last - source) })
  } while ((source += HIZ_PASS_LEVELS) < last)
  return passes
}

/**
 * Every pass's source and destinations are a function of the target size alone, so the whole
 * uniform array is written once per allocation and no image uploads a byte to build the pyramid.
 * Slot `i`, `slotStride` bytes from the next, holds pass `i`: its source level's offset and size,
 * the count of levels it writes, `upper` — the texels of the coarser levels of one bound, by which
 * the layers' bounds lie apart there (`hizRoute`) — then each written level's index and size;
 * `offsets` are the levels' indices in the culling layer's routing. The source at index zero is level 0, read from the texture.
 */
export function hizBuildWords(
  sizes: Array<[number, number]>,
  offsets: number[],
  passes: HizBuildPass[],
  slotStride: number,
  upper: number,
) {
  const slot = slotStride / 4,
    words = new Uint32Array(passes.length * slot)
  passes.forEach(({ source, width, height, levels }, i) => {
    words.set([offsets[source], width, height, levels, upper], i * slot)
    for (let k = 0; k < levels; k++) {
      const level = source + 1 + k
      // After the pass's header (the source level), one `vec4u` per level it writes (`dst`).
      words.set([offsets[level], ...sizes[level]], i * slot + HIZ_UNI.at.dst + 4 * k)
    }
  })
  return words
}
