import { readClosureSetting } from '../../../../sdk-core/src/contracts/closureOptions.ts'
import { closureSlotsOf, effectiveMaxClosures } from '../../materials/closures/viewClosures.ts'
import { withClosures } from '../../materials/surface/surfaceAllocation.ts'
import { closuresHeld } from '../../materials/surface/surfaceOutputs.ts'
import { swapSurfaces } from '../backend/state/gpu.ts'
import { isProgram, programOf } from '../../materials/graph/surfaceProgram.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** What the closures per pixel are worked out from, and the result: the census read, the settings, and the most closures a pixel keeps. */
export interface ClosureState {
  /** The census revision the most was counted for, -1 before a census. */
  census: number
  /** The sum of the shapes of the graphs the most was counted for: a graph whose closure tree changed moves it, the census not having moved. */
  shapes: number
  /** The image and the census revision the shapes were summed for: the sum is taken once an image, whatever the number of readers. */
  summed: { frame: number; revision: number; shapes: number }
  /** The limit the programs were last compiled for (`applied`: none before the first frame) and the setting the most was worked out from. */
  applied: number | undefined
  limit: number
  countFromMaterial: boolean
  /** The most closures any surface the census counts has, whatever the limit and the setting. */
  most: number
  /** The closures a pixel keeps: the most any surface the census counts has, held to the limit, or the limit alone. */
  max: number
}

/** The closure settings of the runtime, read once for a frame. */
export const closuresOf = (rt: WebgpuPagesRuntime) => ({
  limit: readClosureSetting(rt, 'closuresPerPixel'),
  countFromMaterial: readClosureSetting(rt, 'closureCountFromMaterial'),
})

const stateOf = (rt: WebgpuPagesRuntime): ClosureState =>
  (rt.vis.closures ??= {
    census: -1,
    shapes: 0,
    summed: { frame: -1, revision: -1, shapes: 0 },
    applied: undefined,
    limit: 0,
    countFromMaterial: true,
    most: 1,
    max: 1,
  })

/**
 * The project's closures per pixel, before the surfaces' records are followed: the runtime holds the limit its programs are compiled for
 * (`applied`, which `limitOf` reads from what every caller receives of the runtime: no module state), and the records of the surfaces
 * whose graph has a closure tree — the transparent pass's too — are written again when it changed (`MaterialTable.forget`), none when no
 * surface of the scene has one.
 */
export function followClosureLimit(rt: WebgpuPagesRuntime) {
  const { limit } = closuresOf(rt),
    state = stateOf(rt),
    before = state.applied
  state.applied = limit
  if (before === undefined || before === limit) return
  for (const surface of rt.vis.shadeCensus?.surfaces ?? [])
    if (surface.graph?.closureRoot !== undefined) {
      rt.vis.materialTable.forget()
      return
    }
}

/**
 * The most closures a pixel of the drawn view keeps: the most any surface the scene wears has (the census of the worn surfaces, whose
 * programs say their count), read again only when the census was taken again, a graph's shape moved (a closure tree set again) or a setting moved; then held to the project's closures per
 * pixel, or that alone where the count is not taken from the materials.
 */
export function viewClosureMax(rt: WebgpuPagesRuntime) {
  const { limit, countFromMaterial } = closuresOf(rt),
    state = stateOf(rt),
    census = rt.vis.shadeCensus,
    revision = census?.revision ?? -1
  const { summed } = state
  if (summed.frame !== rt.run.frame || summed.revision !== revision) {
    let sum = 0
    for (const surface of census?.surfaces ?? []) sum += surface.graph?.shape ?? 0
    summed.shapes = sum
    summed.frame = rt.run.frame
    summed.revision = revision
  }
  if (
    state.census !== revision ||
    state.shapes !== summed.shapes ||
    state.limit !== limit ||
    state.countFromMaterial !== countFromMaterial
  ) {
    let most = 1
    for (const surface of census?.surfaces ?? []) {
      const program = programOf(surface, undefined, limit)
      if (isProgram(program)) most = Math.max(most, closureSlotsOf(program.compiled))
    }
    Object.assign(state, {
      census: revision,
      shapes: summed.shapes,
      limit,
      countFromMaterial,
      most,
      max: effectiveMaxClosures(countFromMaterial, most, limit),
    })
  }
  return state.max
}

/**
 * Whether the readers evaluate several closures a pixel: the drawn view's pixels hold more than one (`viewClosureMax`), the reference's
 * `Lumen::SupportsMultipleClosureEvaluation(View)`: its views' most closures per pixel past one (`Lumen.cpp:189-197`; its first test, that
 * the gbuffer is not blendable, holds for every view of ours). A reader compiles its variant of several closures only then, so a
 * scene of one closure keeps every reader's text and work.
 */
export const supportsMultipleClosures = (rt: WebgpuPagesRuntime) => viewClosureMax(rt) > 1

/** The most closures any surface of the scene has: below two, no pixel holds several, whatever the record is sized for. */
export function mostClosures(rt: WebgpuPagesRuntime) {
  viewClosureMax(rt)
  return stateOf(rt).most
}

/**
 * At every image's start, before anything names the surfaces (`encodeVis`): the drawn view's record holds the closure slices its most
 * closures a pixel asks (`viewClosureMax`) — none for one closure —, remade alone when that changes (`withClosures`), the frame's other
 * targets staying.
 */
export function followClosureLayers(rt: WebgpuPagesRuntime) {
  const { gpu } = rt,
    surfaces = gpu.surfaces
  if (!surfaces || !gpu.device) return
  const wanted = viewClosureMax(rt)
  if (surfaces.closures === closuresHeld(wanted)) return
  swapSurfaces(gpu, surfaces, withClosures(gpu.device, surfaces, wanted))
}
