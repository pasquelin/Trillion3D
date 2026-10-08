import { boxCornersInto } from '../../../sdk-core/src/index.ts'
import { BOX_CORNER_VALUES, HIZ_BOUNDS_VALUES, projectCornersInto, rowBox } from './corners.ts'
import type { HizPage } from './types.ts'
import type { EngineCamera } from '../camera/world.ts'
import { locationOf, type PageLocations } from '../page/selection/placements.ts'
import type { MatrixElements } from '../host/matrixElements.ts'

const cornerScratch = new Float64Array(BOX_CORNER_VALUES)
/**
 * Conservative screen AABB of one box into `into` at `base`. min/max are inclusive integer samples
 * (fillIds last pixel is ceil(max)). Near-plane crossings never reject. The caller passes the view
 * and view-projection elements, so a batch builds them once instead of once per box; the arithmetic
 * is `boxCornersInto` (sdk-core) for both, so the flat and object forms agree bit for bit.
 */
function projectBoxInto(
  min: readonly number[],
  max: readonly number[],
  world: MatrixElements,
  viewElements: ArrayLike<number>,
  viewProjElements: ArrayLike<number>,
  near: number,
  width: number,
  height: number,
  into: Float64Array,
  base: number,
) {
  boxCornersInto(cornerScratch, 0, min[0], min[1], min[2], max[0], max[1], max[2], world.elements)
  projectCornersInto(
    cornerScratch,
    0,
    viewElements,
    viewProjElements,
    near,
    width,
    height,
    into,
    base,
  )
}

export function projectBoxesFlat(
  pages: ArrayLike<HizPage | undefined>,
  locations: PageLocations,
  count: number,
  cam: EngineCamera,
  viewport: [number, number],
  into: Float64Array,
  only?: Uint8Array,
) {
  const [width, height] = viewport
  // View, view-projection and near plane come from the engine camera: a frame sets them once.
  const view = cam.view,
    elements = cam.viewProjection,
    near = cam.near
  for (let i = 0; i < count; i++) {
    if (only && !only[i]) continue
    const page = pages[i]
    if (!page) continue
    const { min, max } = rowBox(page),
      base = i * HIZ_BOUNDS_VALUES
    projectBoxInto(
      min,
      max,
      locationOf(locations, i).world,
      view,
      elements,
      near,
      width,
      height,
      into,
      base,
    )
  }
}

let boundsScratch = new Float64Array(HIZ_BOUNDS_VALUES)
/** Rectangles of a frame, in a buffer that grows only with the largest cut seen.
 *  One caller at a time: bounds do not outlive the pass that asked for them. */
export function boundsFor(count: number) {
  const need = Math.max(1, count) * HIZ_BOUNDS_VALUES
  if (boundsScratch.length < need) boundsScratch = new Float64Array(need)
  return boundsScratch
}
