// The decode's kernels (`decodeWgsl.ts`) run on the CPU, a thread after the other over the words
// their buffers hold: what a fake device replays of them. The plan writes the ranges of a pass and
// the dispatch of its decode; the decode writes the record of each cluster of the ranges; the
// deformation's plan the dispatch of the deformation. Each function is the kernel's text in
// JavaScript, field by field (`PAGE_INFO`, `CLUSTER_INFO`, `PLACEMENT_INFO`).
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'
import { WORKGROUP_THREADS, dispatchGrid } from '../../gpu/dispatch/grid.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { DIAGNOSTIC_DRAWN_AS_WGSL } from '../../diagnostic/colors.ts'
import { VISIBLE_RECORD_WORDS } from '../../geometry/dag/visible/layout.ts'
import {
  NO_SPLIT,
  VIS_SW,
  VIS_HW,
  VIS_SW_SPLIT,
  VIS_HW_SPLIT,
  VIS_TAG_BLENDED,
  VISIBLE_HEADER_WORDS,
} from '../../geometry/dag/visible/layout.fixture.ts'
import { CLUSTER_INFO } from '../../geometry/dag/info/clusterInfoLayout.ts'
import {
  NO_OUTPUTS,
  PLACEMENT_EVALUATE,
  PLACEMENT_HLOD_SHIFT,
  PLACEMENT_HOLDOUT,
  PLACEMENT_INFO,
  PLACEMENT_PAGE_MARKS,
  PLACEMENT_VELOCITY,
} from '../../geometry/dag/info/placementInfoLayout.ts'
import { PAGE_INFO } from '../pageInfo.ts'
import { FLAG_HOLDOUT, WPO_ROW_ALWAYS, WPO_ROW_VELOCITY } from '../types.ts'
import { VIS_TRIANGLE_BITS } from '../visWords.ts'
import { DEFORM } from './contract.ts'
import { DECODE_ARGS_WORDS, RANGE, RANGE_WORDS } from './contract.fixture.ts'

/** The unsigned and the float words of `bytes`, over the same memory. */
function viewOf(bytes: Uint8Array) {
  return {
    u: new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2),
    f: new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2),
  }
}

const bits = new Float64Array(1),
  halves = new Uint32Array(bits.buffer)
/** The double a root's world holds at `at`: its high word, then its low one. */
function double(held: Uint32Array, at: number) {
  halves[1] = held[at]
  halves[0] = held[at + 1]
  return bits[0]
}

/** The buffers the decode binds (`DecodeInputs`), as the bytes they hold. */
export type DecodeBytes = {
  visible: Uint8Array
  info: Uint8Array
  rootWorlds: Uint8Array
  placements: Uint8Array
  outputs: Uint8Array
  pages: Uint8Array
  work: Uint8Array
  args: Uint8Array
}

/** `decodePlan` of `pass`: the ranges of the pass in the work buffer, the dispatch of its decode in
 *  the arguments, the deformation's list emptied. `width` is the device's dispatch width. */
export function replayDecodePlan(bytes: DecodeBytes, pass: number, width?: number) {
  const visible = viewOf(bytes.visible).u,
    work = viewOf(bytes.work).u,
    args = viewOf(bytes.args).u
  const cap = Math.floor((visible.length - VISIBLE_HEADER_WORDS) / VISIBLE_RECORD_WORDS)
  const sw = Math.min(visible[VIS_SW], cap),
    hw = Math.min(visible[VIS_HW], cap - sw),
    swSplit = visible[VIS_SW_SPLIT],
    hwSplit = visible[VIS_HW_SPLIT]
  let swFirst = 0,
    swCount = 0,
    hwFirst = cap - hw,
    hwCount = 0
  if (pass === 0) {
    swCount = Math.min(sw, swSplit)
    hwCount = Math.min(hw, hwSplit)
    hwFirst = cap - hwCount
  } else if (swSplit !== NO_SPLIT) {
    swFirst = Math.min(sw, swSplit)
    swCount = sw - swFirst
    hwCount = hw - Math.min(hw, hwSplit)
  }
  const at = pass * RANGE_WORDS
  work[at + RANGE.swFirst] = swFirst
  work[at + RANGE.swCount] = swCount
  work[at + RANGE.hwFirst] = hwFirst
  work[at + RANGE.hwCount] = hwCount
  const [x, y] = dispatchGrid(ceilDiv(swCount + hwCount, WORKGROUP_THREADS), width)
  args.set([x, y, 1], pass * DECODE_ARGS_WORDS)
  work[DEFORM.at + DEFORM.count] = 0
}

/** `deformPlan`: the deformation's dispatch over the clusters the decode listed. */
export function replayDeformPlan(work: Uint8Array, width?: number) {
  const words = viewOf(work).u
  const [x, y] = dispatchGrid(words[DEFORM.at + DEFORM.count], width)
  words.set([x, y, 1], DEFORM.at + DEFORM.groups)
}

/** `decode` of `pass`: the record of every cluster of the pass's ranges, at its index in the list. */
export function replayDecode(bytes: DecodeBytes, pass: number) {
  const visible = viewOf(bytes.visible).u,
    { u: info, f: infoFloats } = viewOf(bytes.info),
    rootWorlds = viewOf(bytes.rootWorlds).u,
    placements = viewOf(bytes.placements),
    outputs = viewOf(bytes.outputs).u,
    pages = viewOf(bytes.pages),
    work = viewOf(bytes.work).u
  const drawnAs = shaderRun<{ diagnosticDrawnAs(word: number, drawn: number): number }>(
    DIAGNOSTIC_DRAWN_AS_WGSL,
    ['diagnosticDrawnAs'],
    {},
  ).diagnosticDrawnAs
  const at = pass * RANGE_WORDS
  const swCount = work[at + RANGE.swCount],
    count = swCount + work[at + RANGE.hwCount]
  const page = PAGE_INFO.at,
    cluster = CLUSTER_INFO.at,
    place = PLACEMENT_INFO.at
  for (let t = 0; t < count; t++) {
    const v = t < swCount ? work[at + RANGE.swFirst] + t : work[at + RANGE.hwFirst] + (t - swCount)
    const r = VISIBLE_HEADER_WORDS + VISIBLE_RECORD_WORDS * v
    if ((visible[r + 2] & VIS_TAG_BLENDED) !== 0) continue
    const i = visible[r],
      w = visible[r + 1]
    // The worlds are doubles, two words each, `MATRIX_VALUES` of them a root.
    if (
      (w + 1) * MATRIX_VALUES > rootWorlds.length / 2 ||
      (w + 1) * PLACEMENT_INFO.words > placements.u.length
    )
      continue
    const p = w * PLACEMENT_INFO.words,
      infoShift = placements.u[p + place.infoShift]
    // A shift below zero is its two's complement: the sum wraps as the kernel's.
    const c = ((i + infoShift) >>> 0) * CLUSTER_INFO.words
    const out = v * PAGE_INFO.words
    // The world in single precision: the doubles' roundings, stored as floats.
    for (let k = 0; k < MATRIX_VALUES; k++)
      pages.f[out + page.world + k] = double(rootWorlds, (w * MATRIX_VALUES + k) * 2)
    const flags = info[c + cluster.flags],
      wpo = info[c + cluster.wpo],
      switches = placements.u[p + place.switches]
    pages.u[out + page.flags] =
      (flags | ((switches & PLACEMENT_HOLDOUT) !== 0 ? FLAG_HOLDOUT : 0)) >>> 0
    pages.u[out + page.marks] = switches & PLACEMENT_PAGE_MARKS
    pages.u[out + page.pageOffset] = info[c + cluster.pageOffset]
    pages.u[out + page.indexCount] = info[c + cluster.indexCount]
    pages.u[out + page.vertexBase] = info[c + cluster.vertexBase]
    pages.u[out + page.packedBase] = ((v + 1) << VIS_TRIANGLE_BITS) >>> 0
    pages.u[out + page.clusterHash] = info[c + cluster.clusterHash]
    pages.u[out + page.selectionIndex] = i
    pages.u[out + page.diagnosticWord] = drawnAs(
      info[c + cluster.diagnosticWord],
      switches >>> PLACEMENT_HLOD_SHIFT,
    )
    pages.u[out + page.depthBias] = info[c + cluster.depthBias]
    pages.u[out + page.placement] = w
    pages.u[out + page.materialClass] = info[c + cluster.materialClass]
    pages.u[out + page.deform] = placements.u[p + place.deform]
    let deformCount = 0,
      deformOutput = 0
    const outputsAt = placements.u[p + place.outputs]
    if (outputsAt !== NO_OUTPUTS) {
      const o = outputsAt + 2 * (i - placements.u[p + place.pageBase])
      deformCount = outputs[o]
      deformOutput = outputs[o + 1]
    }
    pages.u[out + page.deformCount] = deformCount
    pages.u[out + page.deformOutput] = deformOutput
    pages.u[out + page.material] = info[c + cluster.material]
    const moves =
      wpo !== 0 && ((switches & PLACEMENT_EVALUATE) !== 0 || (wpo & WPO_ROW_ALWAYS) !== 0)
    pages.u[out + page.wpo] = moves
      ? (wpo | ((switches & PLACEMENT_VELOCITY) !== 0 ? WPO_ROW_VELOCITY : 0)) >>> 0
      : 0
    for (let k = 0; k < 3; k++)
      pages.f[out + page.wpoCentre + k] = moves ? placements.f[p + place.wpoCentre + k] : 0
    pages.f[out + page.wpoDisableSq] = moves ? placements.f[p + place.wpoDisableSq] : 0
    pages.f[out + page.wpoMost] = moves
      ? Math.max(placements.f[p + place.wpoMost], infoFloats[c + cluster.wpoMost])
      : 0
    if (deformOutput !== 0 && deformCount !== 0 && info[c + cluster.indexCount] !== 0) {
      const k = work[DEFORM.at + DEFORM.count]++
      work[DEFORM.at + DEFORM.list + k] = v
    }
  }
}
