import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import {
  customDepthWritesStencil,
  readCustomDepthSetting,
} from '../../../../sdk-core/src/contracts/customDepthOptions.ts'
import { resolveCameraWorld, type ViewCamera } from '../../camera/world.ts'
import { aheadTaaImage } from '../../post/taa/frame.ts'
import { countMainImage } from '../backend/state/renderScale.ts'
import { createViewScale } from '../view/viewScale.ts'
import { createViewGpuTiming } from '../prepare/timing.ts'
import { NO_OVERRIDES } from '../backend/state/viewOverrides.ts'
import { breakHeldFrame, createWebgpuView, type WebgpuView } from '../backend/state/view.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { createCustomDepthTargets } from '../../visibility/customDepth/customDepthTargets.ts'
import { encodeCustomDepthEmit } from '../../visibility/customDepth/customDepthEmit.ts'
import type { PersistentViews } from './encodeSkyMeshes.ts'

/**
 * THE CUSTOM DEPTH IN THE FRAME (`customDepth` of the settings, `Object3D.renderCustomDepth`): while an object asks for it, the main view's image
 * is drawn again, before the main view, by a view of its own (`persistentView.ts`) that sees only the objects that ask — whatever stands in front
 * of them: the roots of every other object are left out of its cut (`ViewOverrides.customDepthCapture`, `cutViewSet.ts`). It is the main view's
 * camera, size and lists; its image is the visibility buffer alone, with no lighting, shadow, fog, sky nor effect, and in the place of the surfaces'
 * shading its visibility is emitted (`encodeCustomDepthView`) into the custom depth target and, in the mode that writes the stencil (`customDepth`
 * 3), the custom stencil target, each pixel taking the value of its object (`encodeCustomDepthEmit`). The view takes the size and the jitter of the
 * main view's image about to be drawn (`aheadTaaImage`) and is drawn again whenever the sample moves, so it is redrawn with the main view. The view
 * is made when the first object asks and stays, parked, when none does; its targets are made when an object asks and given back when none does, in
 * the mode that makes them on demand (`customDepth` 1), and stay in the modes that keep them (2 and 3), cleared by the view's next images. The mode 0
 * draws and keeps nothing. Where no object ever asked, nothing is made, drawn nor kept: the image is the one it would be without the feature.
 */

/** The optics the view takes from the main camera. */
const OPTICS = ['fov', 'near', 'far', 'zoom', 'aspect', 'left', 'right', 'top', 'bottom'] as const

/** What a runtime holds of its custom depth. */
interface Held {
  readonly camera: Camera
  readonly view: WebgpuView
  readonly targets: ReturnType<typeof createCustomDepthTargets>
  /** The projection of the camera, which cannot change: another projection of the main camera makes another view. */
  readonly projection: 'perspective' | 'orthographic'
  /** The size the view was last resized to. */
  size?: readonly [number, number]
  /** No object asks: the view is kept but not drawn, its targets given back where the mode makes them on demand. */
  parked: boolean
  /** The size of the main view's image about to be drawn, and the jitter the view was last drawn with (offset and grid width), for the next. */
  readonly ahead: number[]
  readonly seen: number[]
  /** The view failed to draw: it is not tried again until the set of objects that ask changes. */
  failedAt?: number
  /** The jitter the view is drawn with (`ViewOverrides.customDepthCapture.jitter`), rewritten by each image. */
  readonly jitter: { offset: Float64Array; grid: Float64Array; matrix: Float64Array }
  /** The cut's hidden roots last made, with what they were made from (`hiddenRoots`). */
  hidden?: { viewed: readonly number[]; revision: number; roots: number; list: readonly number[] }
}
const states = new WeakMap<WebgpuPagesRuntime, Held>()

/** The ranks of the roots the custom depth view does not draw: those the main view's rules hide (`viewed`) and every root whose object does not ask. */
function hiddenRoots(rt: WebgpuPagesRuntime, held: Held, viewed: readonly number[]) {
  const roots = rt.layout.selectionRoots.length
  const offsets = rt.vis.rootOffsets
  const revision = offsets.customDepthRevision()
  const kept = held.hidden
  if (kept && kept.viewed === viewed && kept.revision === revision && kept.roots === roots)
    return kept.list
  const asking = offsets.askingCustomDepth()
  const list = [...viewed]
  for (let rank = 0; rank < roots; rank++) if (!asking.has(rank)) list.push(rank)
  held.hidden = { viewed, revision, roots, list }
  return list
}

function createHeld(rt: WebgpuPagesRuntime, device: GPUDevice, main: ViewCamera): Held {
  const camera = new Camera(main.projection, { far: main.far })
  camera.matrixAutoUpdate = false
  const targets = createCustomDepthTargets()
  const jitter = {
    offset: new Float64Array(2),
    grid: new Float64Array(2),
    matrix: new Float64Array(16),
  }
  const view = createWebgpuView(1, 1, createViewScale(1, rt.views.main.scale), true, {
    ...NO_OVERRIDES,
    skyLighting: false,
    lighting: false,
    reflections: false,
    particles: false,
    lightShafts: false,
    lightFunctions: false,
    post: false,
    customDepthCapture: {
      jitter,
      hidden: (viewed) => hiddenRoots(rt, held, viewed),
      emit: (encoder, drawn) => {
        const { vis, gpu } = rt
        const inputs =
          drawn && vis.visView && vis.pageTable && vis.placementGpu && gpu.depthView
            ? {
                ids: vis.visView,
                drawn: gpu.depthView,
                pages: vis.pageTable,
                placements: vis.placementGpu.buffer,
              }
            : undefined
        encodeCustomDepthEmit(device, encoder, targets, inputs)
      },
    },
  })
  const held: Held = {
    camera,
    view,
    targets,
    jitter,
    projection: main.projection,
    parked: false,
    ahead: [0, 0],
    seen: [NaN, NaN, NaN],
  }
  view.timing.gpuTiming = createViewGpuTiming(rt, device, view)
  rt.views.persistent.push(view)
  return held
}

/** Gives the view of `held` up and its targets with it. */
function release(rt: WebgpuPagesRuntime, held: Held, views: PersistentViews) {
  views
    .remove(rt, held.view)
    .catch((error) => rt.diag.diagnosticFailure('custom-depth-failed', error))
  if (rt.gpu.device) held.targets.release(rt.gpu.device)
}

/** Sets the size and the jitter the view is drawn with, those of the main view's image about to be drawn: the jitter is the main view's
 *  where `customDepthTemporalAAJitter` is on and its temporal pass runs, else none, the view steady. The view's own hold knows nothing of
 *  the jitter: a sample it was not drawn with breaks it. */
function followMainImage(rt: WebgpuPagesRuntime, held: Held, viewport: readonly number[]) {
  const { offset, grid } = held.jitter
  const { ahead, seen } = held
  countMainImage(rt, true)
  const follows =
    aheadTaaImage(rt, ahead, offset) && readCustomDepthSetting(rt, 'customDepthTemporalAAJitter')
  if (!(ahead[0]! > 0)) {
    ahead[0] = viewport[0]!
    ahead[1] = viewport[1]!
  }
  grid[0] = follows ? ahead[0]! : 0
  grid[1] = follows ? ahead[1]! : 0
  const x = follows ? offset[0]! : 0,
    y = follows ? offset[1]! : 0
  if (seen[0] !== x || seen[1] !== y || seen[2] !== grid[0]) breakHeldFrame(rt, held.view)
  seen[0] = x
  seen[1] = y
  seen[2] = grid[0]!
}

/** The custom depth a runtime holds for this image, its depth and, in the mode that writes it, its stencil (two 16-bit channels, the
 *  stencil in `.g`), and the size of both: none while no object asks or the view failed. The post-process materials read these. */
export function customDepthOf(rt: WebgpuPagesRuntime) {
  const held = states.get(rt)
  const depth = held?.targets.depthView
  return held && depth && !held.parked && held.failedAt === undefined
    ? { depth, stencil: held.targets.stencilView, size: held.targets.size }
    : undefined
}

/** Draws the custom depth of this image before the main view's; a failure is said once. */
export function renderCustomDepth(
  rt: WebgpuPagesRuntime,
  main: ViewCamera,
  views: PersistentViews,
) {
  const mode = readCustomDepthSetting(rt, 'customDepth')
  const { device } = rt.gpu
  const offsets = rt.vis.rootOffsets
  let held = states.get(rt)
  const wanted = !!device && mode !== 0 && offsets.askingCustomDepth().size > 0
  // The projection of the main camera is the view's for good: another makes another view.
  if (held && held.projection !== main.projection) {
    release(rt, held, views)
    states.delete(rt)
    held = undefined
  }
  if (!wanted) {
    // No object asks: the view stays, parked. The modes that make the targets on demand give them back; the others keep them.
    if (held) {
      held.parked = true
      if (mode <= 1 && device) held.targets.release(device)
    }
    return
  }
  if (rt.capture.capturing || rt.run.lost || !rt.gpu.cache) return
  held ??= (() => {
    const made = createHeld(rt, device, main)
    states.set(rt, made)
    return made
  })()
  held.parked = false
  const revision = offsets.customDepthRevision()
  if (held.failedAt === revision) return
  held.failedAt = undefined
  const { camera, view, targets } = held
  resolveCameraWorld(main)
  camera.matrix.elements.set(main.matrixWorld.elements)
  for (const optic of OPTICS) if (camera[optic] !== main[optic]) camera[optic] = main[optic]
  ;(camera as ViewCamera).orthographic = main.orthographic
  ;(camera as ViewCamera).viewTile = main.viewTile
  camera._viewSet = main._viewSet
  followMainImage(rt, held, rt.setup.viewport)
  const [width, height] = held.ahead as [number, number]
  if (held.size?.[0] !== width || held.size[1] !== height) {
    views.resize(view, width, height)
    held.size = [width, height]
  }
  targets.ensure(device, width, height, customDepthWritesStencil(mode))
  const { run } = rt
  const outer = run.frameHeld
  run.frameHeld = true
  try {
    views.render(rt, view, camera, 0)
  } catch (error) {
    rt.diag.diagnosticFailure('custom-depth-failed', error)
    held.failedAt = revision
  } finally {
    run.frameHeld = outer
  }
}

/** The session's custom depth given up with it: the persistent views are released whole by the session, the targets are retired. */
export function disposeCustomDepth(rt: WebgpuPagesRuntime) {
  const held = states.get(rt)
  if (!held) return
  if (rt.gpu.device) held.targets.release(rt.gpu.device)
  states.delete(rt)
}
