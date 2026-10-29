import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { createTextOverlay, TEXT_LINE } from '../../../../diagnostic/textOverlay.ts'
import { debugColor } from '../../../../hair/debugLines.ts'
import { rootWorldBox } from '../../../../geometry/selection/rootWorld.ts'
import { encodeShadowCasterColor } from './casterColor.ts'
import { shadowRootAt, shadowRootCount } from '../../casters/shadowRoots.ts'
import {
  MOBILITY_DEFORMS,
  MOBILITY_MOVING,
  MOBILITY_OFFSET_INVALIDATES,
  MOBILITY_OFTEN_MOVING,
  MOBILITY_SHADOWLESS,
} from '../../mobilityBits.ts'

/** The view's name in `DiagnosticMode`. */
export const SHADOW_CASTERS_VIEW = 'virtual-shadow-map-shadow-casters'

/** How the shadows keep a placement, and the colour its box is drawn with. */
export interface CasterClass {
  readonly color: number
  /** Whether the placement's box is drawn: those whose casters invalidate pages, or may. */
  readonly bounds: boolean
}

const STATIC = debugColor(0, 1, 0)
const STATIC_INVALIDATING = debugColor(1, 0, 0)
const DYNAMIC = debugColor(0, 1, 1)
const DYNAMIC_INVALIDATING = debugColor(0.5, 0, 0.5)
const DYNAMIC_MAYBE = debugColor(0, 0, 1)
const NO_SHADOW = debugColor(0.5, 0.5, 0.5)

/**
 * The class of a placement by its mobility word (`casters/mobilityState.ts`): a placement that casts no shadow is grey; one cached as static is green, red when its deformation
 * invalidates its pages; one cached as dynamic is cyan, purple where it moves or deforms (it invalidates), blue where its offset may invalidate. A placement that moves is cached as dynamic at
 * once, so the red of a static placement that moved in the image is that of one that deforms alone.
 */
export function casterClass(word: number): CasterClass {
  if (word & MOBILITY_SHADOWLESS) return { color: NO_SHADOW, bounds: false }
  const deforms = (word & MOBILITY_DEFORMS) !== 0
  if (!(word & (MOBILITY_OFTEN_MOVING | MOBILITY_MOVING)))
    return deforms ? { color: STATIC_INVALIDATING, bounds: true } : { color: STATIC, bounds: false }
  if (word & MOBILITY_MOVING || deforms) return { color: DYNAMIC_INVALIDATING, bounds: true }
  if (word & MOBILITY_OFFSET_INVALIDATES) return { color: DYNAMIC_MAYBE, bounds: true }
  return { color: DYNAMIC, bounds: false }
}

/** The legend's entries: the label and the colour of each class. */
export const CASTER_LEGEND: readonly (readonly [string, number])[] = [
  ['Static, Not Invalidating', STATIC],
  ['Static, Invalidating', STATIC_INVALIDATING],
  ['Dynamic, Not Invalidating', DYNAMIC],
  ['Dynamic, Invalidating', DYNAMIC_INVALIDATING],
  ['Dynamic, Maybe Invalidating', DYNAMIC_MAYBE],
]

const overlays = new WeakMap<object, ReturnType<typeof createTextOverlay>>()

/** Gives the lines of a runtime's shadow caster view back. */
export function disposeShadowCasterBounds(rt: object) {
  overlays.get(rt)?.dispose()
  overlays.delete(rt)
}

/**
 * THE SHADOW CASTERS VIEW (`virtual-shadow-map-shadow-casters`), over the display image: the box of every placement the shadows keep as invalidating or that may (`casterClass`), in the colour of its class,
 * with the legend of the classes, over the image painted in the classes' colours (`casterColor.ts`). The boxes are drawn as edges over the image, whatever lies before them.
 */
export function encodeShadowCasterBounds(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu } = rt
  if (rt.run.diagnostic !== SHADOW_CASTERS_VIEW || !gpu.displayView)
    return disposeShadowCasterBounds(rt)
  // The false colour of the placements' classes first, the boxes over it.
  encodeShadowCasterColor(rt, device, encoder)
  let overlay = overlays.get(rt)
  if (!overlay) overlays.set(rt, (overlay = createTextOverlay(device)))
  overlay.begin(cam)
  const { words } = rt.lights.mobility
  for (let rank = 0, count = shadowRootCount(rt); rank < count; rank++) {
    const root = shadowRootAt(rt, rank)
    if (!root) continue
    const { color, bounds } = casterClass(words[rank]!)
    const box = bounds ? rootWorldBox(root) : undefined
    if (box) overlay.lines.box(box.subarray(0, 3), box.subarray(3, 6), color)
  }
  const [, height] = gpu.displaySize
  const top = height - 100
  overlay.lines.text('Shadow Casters', 8, top - TEXT_LINE, debugColor(1, 1, 1))
  CASTER_LEGEND.forEach(([label, color], at) =>
    overlay.lines.text(label, 8, top + at * TEXT_LINE, color),
  )
  overlay.encode(encoder, gpu.displayView, gpu.displaySize, cam)
}
