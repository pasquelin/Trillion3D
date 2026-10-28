// What the strands' visibility wrote, set against its closed form (`visibilityScenes.ts`) and against
// itself: the samples against the ribbons, the transmittance against the ribbons, the tiles against the
// transmittance, and the compaction against the samples and the tiles. The CPU twins of what the
// shaders pack are here: the proof alone reads them.
import { fromF32Bits } from '../../../packages/math/src/float/bits.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { saturate } from '../../../packages/math/src/scalar/reals.ts'
import { dispatchGrid } from '../../../packages/sdk-browser/src/gpu/dispatch/grid.ts'
import {
  HAIR_COORD_BITS,
  HAIR_COORD_MASK,
  HAIR_COVERAGE_BITS,
  HAIR_COVERAGE_STEPS,
  HAIR_DEPTH_SCALE,
  HAIR_DISPATCH_ARGS_WORDS,
  HAIR_DRAW_ARGS_WORDS,
  HAIR_NODE_DATA_WORDS,
  HAIR_NODE_GROUP_SIZE,
  HAIR_NODE_OFFSET_BITS,
  HAIR_NODE_OFFSET_MASK,
  HAIR_SAMPLE_OFFSETS,
  HAIR_SAMPLE_OFFSET_STEPS,
  HAIR_TILE_ALL,
  HAIR_TILE_FULL,
  HAIR_TILE_LISTS,
  HAIR_TILE_PARTIAL,
  HAIR_TILE_SIZE,
  HAIR_TILE_VERTICES,
} from '../../../packages/sdk-browser/src/hair/visibilityMath.ts'
import {
  HAIR_DEFAULT_MATERIAL,
  HAIR_FLAG,
} from '../../../packages/sdk-browser/src/hair/materialMath.ts'
import {
  hairUnitByte,
  unpackHairDepth,
  unpackHairSample,
} from '../../../packages/sdk-browser/src/hair/materialMath.fixture.ts'
import { HAIR_DEPTH_BIAS } from '../../../packages/sdk-browser/src/hair/depthBias.ts'
import { UNLIT_FLAG } from '../../../packages/sdk-browser/src/materials/surface/surfaceModelWord.ts'
import {
  FULL_COVERAGE,
  HEIGHT,
  SAMPLES,
  WIDTH,
  type ClosedForm,
  type Ribbon,
} from './visibilityScenes.ts'

/** The rank of the first compacted sample of a pixel, and how many it has, from its descriptor. */
const unpackNodeDesc = (desc: number) => ({
  offset: desc & HAIR_NODE_OFFSET_MASK,
  count: desc >>> HAIR_NODE_OFFSET_BITS,
})

/** The share of a pixel's valid samples that `count` of them are, in 256ths: a whole number, the
 *  quotient exactly. */
const coverage8 = (count: number, valid: number) =>
  Math.min(Math.floor((count * HAIR_COVERAGE_STEPS) / valid), HAIR_COVERAGE_STEPS - 1)

/** A compacted sample's depth and coverage in a word: the depth, cut to whole steps, above the
 *  coverage. The depth times the step is one product of two floats, rounded once to a float, as the
 *  shader rounds it. */
const packDepthCoverage = (depth: number, share: number) =>
  ((Math.floor(Math.fround(depth * HAIR_DEPTH_SCALE)) << HAIR_COVERAGE_BITS) | share) >>> 0

/** The coverage of a pixel from the transmittance of the strands over it: the share of `threshold`
 *  that the light stopped is, from 0 to 1. */
const transmittanceToCoverage = (transmittance: number, threshold: number) =>
  saturate(Math.min(1 - transmittance, 1) / threshold)

/** What the proof reads back of an image. */
export interface Readbacks {
  /** Whether the samples are the 64-bit words' pairs (identifier, depth key), else two planes. */
  readonly wide: boolean
  readonly samples: Uint32Array
  readonly transmittance: Float32Array
  readonly tiles: { x: number; y: number; capacity: number }
  readonly tileCounts: Uint32Array
  readonly tileLists: Uint32Array
  readonly drawArgs: Uint32Array
  readonly dispatchArgs: Uint32Array
  readonly descriptors: Uint32Array
  readonly coverage: Float32Array
  readonly placed: number
  readonly nodeVis: Uint32Array
  readonly nodeCoord: Uint32Array
  readonly nodeArgs: Uint32Array
  /** The materials of the compacted samples (`HAIR_NODE_DATA_WORDS` words each). */
  readonly nodeData: Uint32Array
  /** The depth of the nearest strand of each pixel, the opaque depth after the patch, and the surfaces'
   *  flags after it. */
  readonly hairOnlyDepth: Float32Array
  readonly depth: Float32Array
  readonly flags: Uint32Array
  /** What the opaque depth and the flags held before the strands patched them. */
  readonly depthBefore: number
  readonly flagsBefore: number
}

/** The identifier and depth key of sample `index`. */
const sampleAt = (read: Readbacks, index: number) =>
  read.wide
    ? { id: read.samples[index * 2]!, key: read.samples[index * 2 + 1]! }
    : { id: read.samples[WIDTH * HEIGHT * SAMPLES + index]!, key: read.samples[index]! }

/** The samples against the ribbons: each sample a ribbon covers (clear of its edges) holds that
 *  ribbon's identifier at its depth, any other holds none. `occluded` is an opaque surface in front. */
export function checkSamples(
  read: Readbacks,
  form: ClosedForm,
  ribbons: readonly Ribbon[],
  occluded: boolean,
) {
  const offsets = HAIR_SAMPLE_OFFSETS[SAMPLES]
  const found = { compared: 0, covered: 0, mismatches: 0, ids: 0, joints: 0, depthGap: 0 }
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++)
      for (let s = 0; s < SAMPLES; s++) {
        const sx = x + 0.5 + offsets[s]![0] / HAIR_SAMPLE_OFFSET_STEPS
        const sy = y + 0.5 + offsets[s]![1] / HAIR_SAMPLE_OFFSET_STEPS
        const hits = ribbons.map((ribbon) =>
          form.coverage(sx, sy, ribbon, form.halfWidth(ribbon, SAMPLES)),
        )
        if (!hits.every((hit) => hit.clear)) continue
        const held = sampleAt(read, (y * WIDTH + x) * SAMPLES + s)
        const expected = occluded ? undefined : ribbons[hits.findIndex((hit) => hit.covered)]
        const written = held.key !== 0
        found.compared++
        if (written !== (expected !== undefined)) found.mismatches++
        if (written && !hits.some((hit) => hit.covered)) found.joints++
        if (!written || !expected) continue
        found.covered++
        if (held.id !== expected.id) found.ids++
        found.depthGap = Math.max(found.depthGap, Math.abs(fromF32Bits(held.key) / form.depth - 1))
      }
  return found
}

/** The transmittance against the ribbons: the product of the shares the ribbons that cover a pixel's
 *  centre let through, 1 where none does or an opaque surface is in front. */
export function checkTransmittance(
  read: Readbacks,
  form: ClosedForm,
  ribbons: readonly Ribbon[],
  occluded: boolean,
) {
  const found = { compared: 0, touched: 0, gap: 0 }
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      let wanted = 1
      let clear = true
      for (const ribbon of ribbons) {
        const hit = form.coverage(x + 0.5, y + 0.5, ribbon, form.halfWidth(ribbon, 1))
        clear &&= hit.clear
        if (hit.covered && !occluded) wanted *= form.transmittance(ribbon)
      }
      if (!clear) continue
      const held = read.transmittance[y * WIDTH + x]!
      found.compared++
      found.gap = Math.max(found.gap, Math.abs(held - wanted))
      if (held < 1) found.touched++
    }
  return found
}

/** The list a tile belongs to by the transmittance over its pixels, as a tile outside the image counts
 *  for no strand; none for a tile with no strand. */
function listOfTile(read: Readbacks, tx: number, ty: number) {
  let full = true,
    partial = false
  for (let j = 0; j < HAIR_TILE_SIZE; j++)
    for (let i = 0; i < HAIR_TILE_SIZE; i++) {
      const x = tx * HAIR_TILE_SIZE + i,
        y = ty * HAIR_TILE_SIZE + j
      const t = x < WIDTH && y < HEIGHT ? read.transmittance[y * WIDTH + x]! : 2
      full &&= t <= 1 - FULL_COVERAGE
      partial ||= t < 1
    }
  return full ? HAIR_TILE_FULL : partial ? HAIR_TILE_PARTIAL : undefined
}

/** Whether the pixel (`x`, `y`) lies in a tile of `listed` (`tileSets`): the pixels whose descriptor and
 *  coverage the compaction writes, which every reader goes through. */
const inTiles = (listed: Set<string>, x: number, y: number) =>
  listed.has(`${Math.floor(x / HAIR_TILE_SIZE)},${Math.floor(y / HAIR_TILE_SIZE)}`)

/** The tiles of each list, as sets of `x,y`. */
function tileSets(read: Readbacks) {
  return Array.from({ length: HAIR_TILE_LISTS }, (_, list) => {
    const words = Array.from(
      { length: read.tileCounts[list]! },
      (_, k) => read.tileLists[list * read.tiles.capacity + k]!,
    )
    return new Set(words.map((word) => `${word & HAIR_COORD_MASK},${word >>> HAIR_COORD_BITS}`))
  })
}

/** The tiles against the transmittance: each in the lists its pixels put it in, and no other; and the
 *  arguments of the draws and dispatches against the counts. */
export function checkTiles(read: Readbacks) {
  const sets = tileSets(read)
  let mismatches = 0
  for (let ty = 0; ty < read.tiles.y; ty++)
    for (let tx = 0; tx < read.tiles.x; tx++) {
      const list = listOfTile(read, tx, ty)
      const key = `${tx},${ty}`
      const lists = sets.flatMap((set, k) => (set.has(key) ? [k] : []))
      const wanted = list === undefined ? [] : [HAIR_TILE_ALL, list]
      if (lists.join() !== wanted.join()) mismatches++
    }
  const argsMatch = sets.every((_, list) => {
    const count = read.tileCounts[list]!
    const [x, y] = dispatchGrid(count)
    const at = list * HAIR_DISPATCH_ARGS_WORDS
    return (
      read.drawArgs[list * HAIR_DRAW_ARGS_WORDS] === HAIR_TILE_VERTICES &&
      read.drawArgs[list * HAIR_DRAW_ARGS_WORDS + 1] === count &&
      read.dispatchArgs[at] === x &&
      read.dispatchArgs[at + 1] === y &&
      read.dispatchArgs[at + 2] === 1
    )
  })
  return { mismatches, argsMatch }
}

/** The compaction against the samples and the tiles: in a listed tile a pixel holds one compacted
 *  sample for each distinct strand its samples hold, with the share of its samples, the nearest depth
 *  and its place; its coverage is the transmittance's where it holds any, else 0. The pixels of the
 *  other tiles are written by no pass, and read by none. */
export function checkCompaction(read: Readbacks) {
  const listed = tileSets(read)[HAIR_TILE_ALL]!
  const found = {
    nodes: 0,
    nodeMismatches: 0,
    sampleMismatches: 0,
    coverageMismatches: 0,
    covered: 0,
  }
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      if (!inTiles(listed, x, y)) continue
      const distinct = new Map<number, { count: number; key: number }>()
      let valid = 0
      for (let s = 0; s < SAMPLES; s++) {
        const held = sampleAt(read, (y * WIDTH + x) * SAMPLES + s)
        if (held.key === 0) continue
        valid++
        const known = distinct.get(held.id)
        distinct.set(held.id, {
          count: (known?.count ?? 0) + 1,
          key: Math.max(known?.key ?? 0, held.key),
        })
      }
      const desc = unpackNodeDesc(read.descriptors[y * WIDTH + x]!)
      found.nodes += distinct.size
      if (desc.count !== distinct.size) found.nodeMismatches++
      const wanted = distinct.size
        ? transmittanceToCoverage(read.transmittance[y * WIDTH + x]!, FULL_COVERAGE)
        : 0
      const coverage = read.coverage[y * WIDTH + x]!
      if (Math.abs(coverage - wanted) > 1e-6) found.coverageMismatches++
      if (coverage > 0) found.covered++
      for (let n = 0; n < desc.count; n++) {
        const at = desc.offset + n
        const entry = distinct.get(read.nodeVis[at * 2 + 1]!)
        const word = entry
          ? packDepthCoverage(fromF32Bits(entry.key), coverage8(entry.count, valid))
          : -1
        if (read.nodeVis[at * 2] !== word || read.nodeCoord[at] !== (x | (y << HAIR_COORD_BITS)))
          found.sampleMismatches++
      }
    }
  const [groupsX, groupsY] = dispatchGrid(ceilDiv(read.placed, HAIR_NODE_GROUP_SIZE))
  const args = [groupsX, groupsY, 1]
  return { ...found, argsMatch: [0, 1, 2].every((k) => read.nodeArgs[k] === args[k]) }
}

/**
 * The materials of the compacted samples against the strands: each sample of a ribbon has its control
 * point and macro group, its coverage from the visibility, its depth, a tangent along the ribbon, the
 * default strand material's colour (in the byte of its square root) and roughness, within three steps,
 * the specular and backlit share of a material that connects none, and the flags and the lighting
 * channel of a groom of the proof's settings.
 */
export function checkMaterial(read: Readbacks, ribbons: readonly Ribbon[], flags: number) {
  const listed = tileSets(read)[HAIR_TILE_ALL]!
  const found = {
    compared: 0,
    controlPoints: 0,
    coverage: 0,
    depthGap: 0,
    tangentGap: 0,
    colorGap: 0,
    roughnessGap: 0,
    fixed: 0,
  }
  const { color, roughness } = HAIR_DEFAULT_MATERIAL
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      if (!inTiles(listed, x, y)) continue
      const desc = unpackNodeDesc(read.descriptors[y * WIDTH + x]!)
      for (let n = 0; n < desc.count; n++) {
        const at = desc.offset + n
        const ribbon = ribbons.find(({ id }) => id === (read.nodeVis[at * 2 + 1]! & 0xffffff))
        const sample = unpackHairSample(
          read.nodeData.subarray(at * HAIR_NODE_DATA_WORDS, (at + 1) * HAIR_NODE_DATA_WORDS),
        )
        found.compared++
        if (!ribbon || sample.controlPoint !== ribbon.id || sample.macroGroup !== 0) {
          found.controlPoints++
          continue
        }
        if (sample.coverage8 !== (read.nodeVis[at * 2]! & 0xff)) found.coverage++
        const wanted = unpackHairDepth(read.nodeVis[at * 2]!, HAIR_DEPTH_SCALE)
        found.depthGap = Math.max(found.depthGap, Math.abs(sample.depth - wanted) / wanted)
        found.tangentGap = Math.max(
          found.tangentGap,
          Math.abs(sample.tangent[0]) * 255,
          Math.abs(sample.tangent[1] - 1) * 255,
          Math.abs(sample.tangent[2]) * 255,
        )
        for (let c = 0; c < 3; c++)
          found.colorGap = Math.max(
            found.colorGap,
            Math.abs(Math.sqrt(sample.baseColor[c]!) - Math.sqrt(color[c]!)) * 255,
          )
        found.roughnessGap = Math.max(
          found.roughnessGap,
          Math.abs(sample.roughness - roughness) * 255,
        )
        if (
          hairUnitByte(sample.specular) !== hairUnitByte(HAIR_DEFAULT_MATERIAL.specular) ||
          hairUnitByte(sample.backlit) !== hairUnitByte(HAIR_DEFAULT_MATERIAL.backlit) ||
          sample.flags !== flags ||
          sample.lightChannels !== HAIR_DEFAULT_MATERIAL.lightChannels
        )
          found.fixed++
      }
    }
  return found
}

/**
 * The depth of the nearest strand and the patch of the surfaces: in a listed tile each pixel holds the
 * greatest depth of its samples, every other pixel 0 (the image has no strand there); where the coverage
 * is whole and the strands light no scene behind them the opaque depth is that depth less the bias and
 * the flags say an unlit surface (casting contact shadows when a strand does); every other pixel holds
 * what it held.
 */
export function checkGbuffer(read: Readbacks, patched: boolean) {
  const listed = tileSets(read)[HAIR_TILE_ALL]!
  const found = {
    pixels: 0,
    nearestMismatches: 0,
    patched: 0,
    depthGap: 0,
    flagMismatches: 0,
    untouchedMismatches: 0,
  }
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const tiled = inTiles(listed, x, y)
      const desc = tiled
        ? unpackNodeDesc(read.descriptors[y * WIDTH + x]!)
        : { offset: 0, count: 0 }
      let nearest = 0,
        scatter = false,
        cast = false
      for (let n = 0; n < desc.count; n++) {
        const at = (desc.offset + n) * HAIR_NODE_DATA_WORDS
        const sample = unpackHairSample(read.nodeData.subarray(at, at + HAIR_NODE_DATA_WORDS))
        nearest = Math.max(nearest, sample.depth)
        scatter ||= (sample.flags & HAIR_FLAG.scatterSceneLight) !== 0
        cast ||= (sample.flags & HAIR_FLAG.castContactShadow) !== 0
      }
      const at = y * WIDTH + x
      if (tiled) found.pixels++
      if (read.hairOnlyDepth[at] !== nearest) found.nearestMismatches++
      const whole = patched && tiled && read.coverage[at]! >= 1 && !scatter
      if (whole) {
        found.patched++
        found.depthGap = Math.max(
          found.depthGap,
          Math.abs(read.depth[at]! - (nearest - HAIR_DEPTH_BIAS)),
        )
        if (read.flags[at] !== UNLIT_FLAG || !cast) found.flagMismatches++
      } else if (read.depth[at] !== read.depthBefore || read.flags[at] !== read.flagsBefore)
        found.untouchedMismatches++
    }
  return found
}

/**
 * The samples of a strand that crosses the near plane, against no gap: the ribbon cut at the plane is
 * a convex quad on the screen, so along each row of samples (one sample position of a pixel row) the
 * samples it covers are one run. A crack between its two triangles is a sample left out inside a run,
 * a sample written twice none (a sample holds one strand). Also how many were covered, on how many
 * pixel rows, and the last of them (the nearest the cut).
 */
export function checkRuns(read: Readbacks) {
  const found = { covered: 0, rows: 0, lastRow: -1, gaps: 0 }
  for (let y = 0; y < HEIGHT; y++) {
    let rowCovered = false
    for (let s = 0; s < SAMPLES; s++) {
      let first = -1,
        last = -1,
        count = 0
      for (let x = 0; x < WIDTH; x++) {
        if (sampleAt(read, (y * WIDTH + x) * SAMPLES + s).key === 0) continue
        if (first < 0) first = x
        last = x
        count++
      }
      if (!count) continue
      rowCovered = true
      found.covered += count
      if (last - first + 1 !== count) found.gaps++
    }
    if (rowCovered) {
      found.rows++
      found.lastRow = y
    }
  }
  return found
}
