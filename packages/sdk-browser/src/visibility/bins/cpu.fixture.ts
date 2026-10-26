// The bins' kernels (`binsWgsl.ts`) run on the CPU: the count, the reservation, the scatter and the
// finalizing of a pass, a thread after the other over the words their buffers hold — what a fake
// device replays of them. The kernel's text in JavaScript, name for name; its atomics happen in
// the order of the threads.
import { DEPTH_LAYER_BIAS_UNITS } from '../../../../sdk-core/src/lod/depthLayer.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { dispatchGrid } from '../../gpu/dispatch/grid.ts'
import { VISIBLE_RECORD_WORDS } from '../../geometry/dag/visible/layout.ts'
import {
  VISIBLE_HEADER_WORDS,
  VIS_TAG_BLENDED,
  VIS_TAG_TESSELLATED,
} from '../../geometry/dag/visible/layout.fixture.ts'
import { PAGE_INFO } from '../pageInfo.ts'
import { FLAG_BACK, FLAG_DOUBLE, FLAG_MASK, FLAG_VOXEL } from '../types.ts'
import { INSTANCE_TOTAL, RANGE, RANGE_WORDS } from '../decode/contract.fixture.ts'
import {
  DEPTH_BUCKETS,
  LIST_AT,
  LIST_COUNT,
  LIST_DISPATCH,
  LIST_ROWS,
  LIST_TESS_AT,
  LIST_TESS_COUNT,
  LIST_TESS_DISPATCH,
  RASTER_PASS_POST,
  headerWord,
} from '../raster/contract.ts'
import {
  BASE_SLOTS,
  BATCH_SHIFT,
  BIN_BACK,
  BIN_FRONT,
  BIN_KIND,
  BIN_NONE,
  CULL_BINS,
  HALF_SLOTS,
  binGroups,
  binScratch,
} from './contract.ts'
import { BIN_PARAMS } from './binsWgsl.ts'

/** The buffers the bins bind (`BinInputs`, `GpuBins`), as the bytes they hold. */
export type BinBytes = {
  pages: Uint8Array
  visible: Uint8Array
  work: Uint8Array
  instances: Uint8Array
  indirect: Uint8Array
  slotOffsets: Uint8Array
  lists: Uint8Array
  uniform: Uint8Array
}

const NONE = 0xffffffff
const words = (bytes: Uint8Array) =>
  new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2)
const floats = (bytes: Uint8Array) =>
  new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2)

/** The bins of `pass` over `bytes`: its clusters counted by group, each group's place reserved, the
 *  clusters scattered, the lists' headers written. `width` is the device's dispatch width. */
export function replayBins(bytes: BinBytes, pass: number, width?: number) {
  const pages = { u: words(bytes.pages), f: floats(bytes.pages) },
    visible = words(bytes.visible),
    work = words(bytes.work),
    instances = words(bytes.instances),
    indirect = words(bytes.indirect),
    slotOffsets = words(bytes.slotOffsets),
    lists = words(bytes.lists),
    uniform = words(bytes.uniform)
  const params = Object.fromEntries(BIN_PARAMS.map((name, k) => [name, uniform[k]])) as Record<
    (typeof BIN_PARAMS)[number],
    number
  >
  // The slots the buffers were made for: one command each.
  const slots = indirect.length / 4,
    layerSlots = slots / BASE_SLOTS
  const g = binGroups(slots),
    s = binScratch(slots)
  const scratch = (word: number) => params.scratch + word
  const page = PAGE_INFO.at
  const range = (k: number) => work[pass * RANGE_WORDS + k]
  const swCount = range(RANGE.swCount),
    count = swCount + range(RANGE.hwCount)
  const clusterOf = (t: number) =>
    t < swCount ? range(RANGE.swFirst) + t : range(RANGE.hwFirst) + (t - swCount)
  const header = (p: number, k: number) => p * headerWord(1) + k

  const kindOf = (flags: number) =>
    (flags & FLAG_VOXEL) !== 0
      ? BIN_KIND.VOXEL
      : (flags & FLAG_MASK) !== 0
        ? BIN_KIND.CUTOUT
        : BIN_KIND.OPAQUE
  const faceOf = (v: number) => {
    const flags = pages.u[v * PAGE_INFO.words + page.flags]
    if ((flags & FLAG_DOUBLE) !== 0) return BIN_NONE
    const m = v * PAGE_INFO.words + page.world,
      f = pages.f
    // The determinant of the world's linear part: its columns' triple product.
    const det =
      f[m] * (f[m + 5] * f[m + 10] - f[m + 6] * f[m + 9]) -
      f[m + 1] * (f[m + 4] * f[m + 10] - f[m + 6] * f[m + 8]) +
      f[m + 2] * (f[m + 4] * f[m + 9] - f[m + 5] * f[m + 8])
    return ((flags & FLAG_BACK) !== 0) !== det < 0 ? BIN_FRONT : BIN_BACK
  }
  const slotOf = (v: number, kind: number) => {
    const bias = pages.u[v * PAGE_INFO.words + page.depthBias]
    const layer =
      kind === BIN_KIND.VOXEL
        ? 0
        : Math.min(Math.floor(bias / DEPTH_LAYER_BIAS_UNITS), layerSlots - 1)
    return pass * HALF_SLOTS + kind * CULL_BINS + faceOf(v) + BASE_SLOTS * layer
  }
  const halfOf = (slot: number) => Math.floor((slot % BASE_SLOTS) / HALF_SLOTS)
  const kindOfSlot = (slot: number) => Math.floor(((slot % BASE_SLOTS) % HALF_SLOTS) / CULL_BINS)
  const sortedGroup = (group: number) => {
    if (group >= slots) return group === g.softwareMasked
    const kind = kindOfSlot(group)
    return kind === BIN_KIND.CUTOUT || kind === BIN_KIND.VOXEL
  }
  const batchesOf = (v: number) =>
    Math.min(
      Math.max(ceilDiv(pages.u[v * PAGE_INFO.words + page.indexCount], params.corners), 1),
      params.perRow,
    )
  /** Where cluster `v` of tag `tag` goes: its group, the instances it takes there, its depth bucket. */
  const placeOf = (v: number, tag: number, software: boolean, extra: boolean) => {
    const place = {
      group: NONE,
      batches: 0,
      bucket: tag & (DEPTH_BUCKETS - 1),
    }
    if ((tag & VIS_TAG_TESSELLATED) !== 0) {
      if (!extra) {
        place.group = g.tessellated
        place.batches = 1
      }
      return place
    }
    if (pages.u[v * PAGE_INFO.words + page.indexCount] === 0) return place
    const kind = kindOf(pages.u[v * PAGE_INFO.words + page.flags])
    if (software && !extra) {
      place.group = kind === BIN_KIND.CUTOUT ? g.softwareMasked : g.softwareOpaque
      place.batches = 1
      return place
    }
    if (extra) {
      if (software && params.softwareSlots !== 0) {
        place.group = slotOf(v, BIN_KIND.SOFTWARE)
        place.batches = batchesOf(v)
      }
      return place
    }
    place.group = slotOf(v, kind)
    place.batches = batchesOf(v)
    return place
  }
  const places = []
  for (let t = 0; t < count; t++) {
    const v = clusterOf(t)
    const tag = visible[VISIBLE_HEADER_WORDS + VISIBLE_RECORD_WORDS * v + 2]
    if ((tag & VIS_TAG_BLENDED) !== 0) continue
    for (let e = 0; e < 2; e++) {
      const place = placeOf(v, tag, t < swCount, e === 1)
      if (place.group !== NONE) places.push({ v, ...place })
    }
  }

  // The count: each group's batches, and each ordered group's per depth bucket.
  for (const p of places) {
    work[scratch(s.count + p.group)] += p.batches
    if (sortedGroup(p.group))
      work[scratch(s.buckets + p.group * DEPTH_BUCKETS + p.bucket)] += p.batches
  }

  // The reservation: each group's place, an ordered group's buckets' places after it.
  const reserve = (group: number, n: number) => {
    if (group < slots) {
      if (n === 0) return 0
      const at = work[INSTANCE_TOTAL]
      work[INSTANCE_TOTAL] += n
      return at
    }
    if (group === g.tessellated)
      return pass === RASTER_PASS_POST ? lists[header(0, LIST_TESS_COUNT)] : 0
    const first = pass === RASTER_PASS_POST ? lists[header(0, LIST_COUNT)] : 0
    return group === g.softwareMasked ? first + work[scratch(s.count + g.softwareOpaque)] : first
  }
  const writeCommand = (slot: number, n: number) => {
    indirect.set([params.corners, n, 0, 0], slot * 4)
  }
  for (let group = 0; group < g.total; group++) {
    const n = work[scratch(s.count + group)]
    const base = reserve(group, n)
    if (sortedGroup(group)) {
      let running = 0
      for (let b = 0; b < DEPTH_BUCKETS; b++) {
        const held = work[scratch(s.buckets + group * DEPTH_BUCKETS + b)]
        work[scratch(s.buckets + group * DEPTH_BUCKETS + b)] = base + running
        running += held
      }
    }
    work[scratch(s.cursor + group)] = base
    work[scratch(s.base + group)] = base
    if (group >= slots) continue
    slotOffsets[group] = base
    if (halfOf(group) === pass)
      writeCommand(
        group,
        n !== 0 ? Math.min(n, params.instanceCap - Math.min(base, params.instanceCap)) : 0,
      )
    else if (pass === 0) writeCommand(group, 0)
  }

  // The scatter: a cluster's instances in the order of the threads.
  const stride = params.corners / 3
  for (const p of places) {
    let at: number
    if (sortedGroup(p.group)) {
      const word = scratch(s.buckets + p.group * DEPTH_BUCKETS + p.bucket)
      at = work[word]
      work[word] += p.batches
    } else {
      const word = scratch(s.cursor + p.group)
      at = work[word]
      work[word] += p.batches
    }
    if (p.group < slots) {
      for (let b = 0; b < p.batches; b++)
        if (at + b < params.instanceCap)
          instances[at + b] = (p.v | ((b * stride) << BATCH_SHIFT)) >>> 0
    } else if (at < params.cap) {
      lists[(p.group === g.tessellated ? LIST_ROWS + params.cap : LIST_ROWS) + at] = p.v
    }
  }

  // The lists' headers.
  const software = Math.min(
    work[scratch(s.count + g.softwareOpaque)] + work[scratch(s.count + g.softwareMasked)],
    params.cap,
  )
  const tessellated = Math.min(work[scratch(s.count + g.tessellated)], params.cap)
  const h = header(pass, 0)
  lists[h + LIST_COUNT] = software
  lists[h + LIST_AT] = LIST_ROWS + work[scratch(s.base + g.softwareOpaque)]
  lists.set([...dispatchGrid(software, width), 1], h + LIST_DISPATCH)
  lists[h + LIST_TESS_COUNT] = tessellated
  lists[h + LIST_TESS_AT] = LIST_ROWS + params.cap + work[scratch(s.base + g.tessellated)]
  lists.set([...dispatchGrid(tessellated, width), 1], h + LIST_TESS_DISPATCH)
}
