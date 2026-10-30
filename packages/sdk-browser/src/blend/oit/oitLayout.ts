import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { clampLowWins } from '../../../../math/src/scalar/reals.ts'
import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { halvings, type ShrunkPool } from '../../session/memory/outOfMemory.ts'

/**
 * WHERE THE FRAGMENTS A PIXEL COLLECTS LIE (`oitWgsl.ts`): two storage buffers of words (two bindings of one group), and the parameters apart in
 * a uniform (`OIT_PARAMS`).
 *  - the head buffer: the globals (`OIT_GLOBAL_WORDS` words: the count of nodes asked of the pool, which goes on counting past its end, the
 *    demand the next images size the pool by, then the largest of the passes' counts of an image, written by the combination), the pixels'
 *    headers (`OIT_HEADER_WORDS` words each, below), then the first `low` slots of every pixel;
 *  - the pool buffer: the other `samples - low` slots of every pixel, then the pool, `OIT_NODE_WORDS` words a node, for the fragments past
 *    the slots (the same words as a slot, then the link into the pixel's list), then the figures of one pixel (`OIT_DEBUG_WORDS`), written
 *    by the combination at the pixel the debug asks for: word 0 the fragments it kept, word 1 the fragments that arrived, then three words
 *    (depth, light, transmittance) for each kept.
 * The slots are split so that neither buffer passes the device's binding limit for the samples asked (`oitSplit`); `low` is the most slots
 * the head buffer holds. A pixel's header is the head of its list in the pool (0 for none), the count of fragments that reached the pixel,
 * and the spill. A pixel keeps at most `OIT_LIST_BOUND` fragments in its slots and its list (a bound on the walk): the fragments past it,
 * and those the pool has no node for, are summed into the spill, light as a per-channel fixed point and transmittance as a fixed point of
 * its negative logarithm, by atomic adds: the sums commute, so the spill is the same whatever the order the fragments arrive in, and nothing
 * is dropped. The first fragments to reach a pixel take a slot each, by the count's atomic add.
 * A slot is the fragment's depth (the bits of a float, smaller is nearer), its light and its transmittance (each packed by `packLight`) and its
 * order key (`oitOrder.ts`), a pair of words: the place of its primitive in the paint order (the plan instance's rank, whole) and the triangle's
 * rank in its cluster. That is five words a sample against the reference's three, the two more being what lets the pixels sort fragments that
 * reach the buffer in the rasterizer's and the atomics' order, whatever it is: the combination sorts the pixel's fragments by the pair.
 * The combination resets the header words of the pixels it composes; the slots and the nodes are valid by the count and the links, never
 * cleared; the node count is cleared after each pass's demand is copied.
 */
export const OIT_GLOBAL_WORDS = 4
/** The globals' words, by name: the nodes asked of the pool by the pass, the largest count of the image's passes. */
export const OIT_GLOBAL_NODES = 0
export const OIT_GLOBAL_DEMAND = 1
/**
 * The header's words, by name: the head of the pool's list, the count of fragments that reached the pixel, then the spill: the light of the
 * fragments past the list (three channels, `OIT_SPILL_SCALE` to the unit), the negative base-2 logarithm of their transmittance (three
 * channels, the same scale), and the word of flags that says which of the six sums reached the top of its range.
 */
export const OIT_HEADER_HEAD = 0
export const OIT_HEADER_COUNT = 1
export const OIT_HEADER_SPILL_LIGHT = 2
export const OIT_HEADER_SPILL_TRANS = 5
export const OIT_HEADER_SPILL_SAT = 8
export const OIT_HEADER_WORDS = 9
/**
 * The fixed point of the spill: its unit (1/256), each value rounded up or down by a hash of its fragment's order key pair (a stochastic rounding,
 * the same every image: the sum of many small values is unbiased, a light of a thousandth is not lost nor a transmittance near one darkened), and the largest light a fragment adds to a channel: a half float's, 65504 (`oitClean`). 256 fragments at that light fit the
 * 32 bits of a sum (256 x 65504 x 256 < 2 to the 32): a sum saturates, and is flagged, only by its wrap past 2 to the 32, so by more than
 * 256 spilled fragments at the top of the range.
 */
export const OIT_SPILL_SCALE = 256
export const OIT_SPILL_LIGHT_MAX = 65504
/** The most a sum of the spill holds, the value a sum that wrapped reads as. */
export const OIT_SPILL_TOP = 0xffffffff
/** The smallest transmittance a fragment lets through into the spill: 2 to the minus this. */
export const OIT_SPILL_TRANS_BITS = 24
/** The fragments the combination sorts at a time (a run), the runs it makes, and so the fragments a pixel keeps in its list: a bound on the walk. */
export const OIT_RUN = 32
export const OIT_RUNS = 8
export const OIT_LIST_BOUND = OIT_RUN * OIT_RUNS
/** A slot's words, by name; a node of the pool has them and the link. */
export const OIT_NODE_DEPTH = 0
export const OIT_NODE_COLOUR = 1
export const OIT_NODE_TRANS = 2
export const OIT_NODE_KEY = 3
export const OIT_NODE_TRI = 4
export const OIT_SLOT_WORDS = 5
export const OIT_NODE_NEXT = 5
export const OIT_NODE_WORDS = 6
/** The most fragments a pixel keeps (`oitMaxSampleCount`'s range). */
export const OIT_MAX_SAMPLES = 16
/** The figures of a pixel: its kept count, its arrived count, then three words (depth, light, transmittance) for each sample it keeps. */
export const OIT_DEBUG_WORDS = 2 + OIT_MAX_SAMPLES * 3
/** The cursor word of a draw that asks for no figures. */
export const OIT_NO_CURSOR = 0xffffffff
/** The group the pipelines that collect bind the buffers in, after the blend's (0) and the reflection's (1). */
export const OIT_GROUP = 2
/** The smallest pool, and the one the buffer starts with: one node for this many pixels, and at least `OIT_POOL_FLOOR` nodes; it grows on the demand counted. */
const OIT_POOL_PIXELS = 8
/** The fewest nodes a pool the device refused is drawn at. */
export const OIT_POOL_FLOOR = 1024
/** The frames a refusal of the device stands before the buffers are asked for again (when the pool has been spent for as many frames, or no buffer is held), and the extent or the device changing lifts it at once. */
export const OIT_RETRY_FRAMES = 60

/** What the device refused: the extent it was refused at, and the frame (counted by the view). */
export interface OitRefusal {
  readonly pixels: number
  readonly frame: number
}

/**
 * Whether a refusal still holds at `frame` for `pixels` pixels. The count of nodes a pass asks stops at the pool (it is tested before it is taken), so
 * a demand never shows past the pool held: the signal that the sorting wants more is the pool being spent, `saturated` frames in a row. A refusal
 * lifts once 60 frames passed and the pool has been spent for 60 frames in a row, or no buffers are held (`held` false: nothing sorts, so nothing can
 * be spent: the clock alone lifts it); an extent change lifts it at once. A refusal is never permanent.
 */
export const oitRefusalHolds = (
  refusal: OitRefusal | undefined,
  pixels: number,
  frame: number,
  saturated: number,
  held: boolean,
) =>
  !!refusal &&
  refusal.pixels === pixels &&
  (frame - refusal.frame < OIT_RETRY_FRAMES || (held && saturated < OIT_RETRY_FRAMES))

/** The bytes cleared after a pass that collected: the node count. */
export const OIT_CLEAR_BYTES = 4

/** The uniform both programs read the image's parameters from. */
export const OIT_PARAMS = fieldLayout('OitParams', [
  ['pitch', 'u32'],
  ['samples', 'u32'],
  ['threshold', 'f32'],
  ['pixels', 'u32'],
  ['nodes', 'u32'],
  ['cursor', 'u32'],
  ['low', 'u32'],
] as const)

/** The nodes the pool starts with and the fewest it may be held to for the sorting to be made at all; it grows on the demand counted. */
export const oitPoolMinimum = (pixels: number) =>
  Math.max(OIT_POOL_FLOOR, ceilDiv(pixels, OIT_POOL_PIXELS))

/** The most nodes a pixel can ask of the pool: its list is bounded. A pool of more is never used. */
export const oitPoolCeiling = (pixels: number, samples: number) =>
  pixels * Math.max(0, OIT_LIST_BOUND - samples)

/** The words of the head buffer: the globals, the headers and the first `low` slots of `pixels` pixels. */
export const oitHeadWords = (pixels: number, low: number) =>
  OIT_GLOBAL_WORDS + pixels * (OIT_HEADER_WORDS + low * OIT_SLOT_WORDS)

/** The words of the pool buffer: the other slots of `pixels` pixels keeping `samples`, a pool of `nodes` nodes and the figures of a pixel. */
export const oitPoolWords = (pixels: number, samples: number, low: number, nodes: number) =>
  pixels * (samples - low) * OIT_SLOT_WORDS + nodes * OIT_NODE_WORDS + OIT_DEBUG_WORDS

/** The most slots a head buffer of `bytes` bytes holds for `pixels` pixels, none where not even the headers fit (-1). */
export const oitSplit = (pixels: number, samples: number, bytes: number) => {
  const room = bytes / 4 - OIT_GLOBAL_WORDS - pixels * OIT_HEADER_WORDS
  return room < 0 ? -1 : Math.min(samples, Math.floor(room / (pixels * OIT_SLOT_WORDS)))
}

/** The nodes of the largest pool a pool buffer of `bytes` bytes holds beside the slots it owns. */
export const oitNodesFitting = (pixels: number, samples: number, low: number, bytes: number) =>
  Math.floor(
    (bytes / 4 - pixels * (samples - low) * OIT_SLOT_WORDS - OIT_DEBUG_WORDS) / OIT_NODE_WORDS,
  )

/** The most samples at most `asked` (a square, as `oitSampleCount` gives them) whose two buffers a device binding `bytes` bytes holds with a pool of at least the minimum; 0 where not even one sample does. */
export const oitSamplesFitting = (pixels: number, asked: number, bytes: number) => {
  for (let side = Math.floor(Math.sqrt(asked)); side > 0; side--) {
    const samples = side * side
    const low = oitSplit(pixels, samples, bytes)
    if (low >= 0 && oitNodesFitting(pixels, samples, low, bytes) >= oitPoolMinimum(pixels))
      return samples
  }
  return 0
}

/** A pool drawn at a size of nodes. */
export interface OitPoolDraw extends ShrunkPool {
  readonly nodes: number
}

/**
 * The pools the device is asked for, for `wanted` nodes: the pool of `wanted` nodes (`bytes`, what the grant starts from), and `draw`, the pool a
 * budget of bytes holds, never under `floor` nodes: the engine's halving rule (`halvings`, `grantedPool`) halves the bytes after each refusal down to
 * `floor` nodes, the last drawn.
 */
export function oitPoolDrawer(
  pixels: number,
  samples: number,
  low: number,
  wanted: number,
  floor: number,
) {
  const draw = (budgetBytes: number): OitPoolDraw => {
    const nodes = clampLowWins(oitNodesFitting(pixels, samples, low, budgetBytes), floor, wanted)
    return {
      nodes,
      budgetBytes,
      allocatedBytes: oitPoolWords(pixels, samples, low, nodes) * 4,
      clamp: nodes <= floor ? 'minimum' : null,
    }
  }
  return { draw, bytes: oitPoolWords(pixels, samples, low, Math.max(floor, wanted)) * 4 }
}

/** The pools `oitPoolDrawer` draws in the order the halving asks them, `wanted` first, `floor` last. */
export function oitPoolDraws(
  pixels: number,
  samples: number,
  low: number,
  wanted: number,
  floor: number,
) {
  const { draw, bytes } = oitPoolDrawer(pixels, samples, low, wanted, floor)
  return halvings(draw(bytes), draw)
}

/** The byte offset, in the pool buffer, of the figures of a pixel. */
export const oitDebugOffset = (pixels: number, samples: number, low: number, nodes: number) =>
  (oitPoolWords(pixels, samples, low, nodes) - OIT_DEBUG_WORDS) * 4

/** The words of the parameters, written each image: one array, seen as unsigned and as float. */
interface OitParamWords {
  readonly u: Uint32Array
  readonly f: Float32Array
}

/** Writes the parameters of an image drawn `width` pixels wide into buffers laid out for `pixels` pixels whose head buffer holds `low` slots and whose pool holds `nodes` nodes (see `OIT_PARAMS`); `cursor` is the pixel whose figures are asked, or `OIT_NO_CURSOR`. */
export function oitParams(
  out: OitParamWords,
  width: number,
  pixels: number,
  samples: number,
  low: number,
  nodes: number,
  threshold: number,
  cursor: number,
) {
  const at = OIT_PARAMS.at
  out.u[at.pitch] = width
  out.u[at.samples] = samples
  out.f[at.threshold] = threshold
  out.u[at.pixels] = pixels
  out.u[at.nodes] = nodes
  out.u[at.cursor] = cursor
  out.u[at.low] = low
  return out
}
