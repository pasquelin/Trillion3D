import { boxCornersInto } from '../../../sdk-core/src/index.ts'
import { BOX_CORNER_VALUES, HIZ_BOUNDS_VALUES, rowBox } from './corners.ts'
import { transformPointRow } from '../../../math/src/vector/vector.ts'
import type { HizPage } from './types.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import { locationOf, type PageLocations } from '../page/selection/placements.ts'
import type { MatrixElements } from '../host/matrixElements.ts'

/** Screen AABB of eight world-space corners, the CPU model of the occlusion and water projections:
 *  term for term the arithmetic of the one-shot path. */
export function projectCornersInto(
  corners: Float64Array,
  from: number,
  viewElements: ArrayLike<number>,
  viewProjElements: ArrayLike<number>,
  near: number,
  width: number,
  height: number,
  into: Float64Array,
  base: number,
) {
  let lowX = Infinity,
    lowY = Infinity,
    highX = -Infinity,
    highY = -Infinity,
    // In reverse-Z, the NEAREST corner is the one whose depth is the GREATEST: the bound the
    // occlusion test compares is therefore a maximum.
    nearestZ = -Infinity,
    clipsNear = false,
    projected = 0
  const v = viewElements,
    e = viewProjElements
  // An affine view — fourth row (0,0,0,1) — yields a denominator of exactly 1 for a finite
  // corner: the dot product is then not computed, and `viewZ * 1` is `viewZ`.
  const affine = v[3] === 0 && v[7] === 0 && v[11] === 0 && v[15] === 1
  // A perspective projection has fourth row (0,0,-1,0), of which `multiplyMatrices` makes
  // exactly the opposite of the view's third row: `cw` is then `-viewZ` to the bit — negation
  // is exact and `(-a) + (-b)` equals `-(a + b)` —, one fewer dot product per corner. Any
  // projection, orthographic or oblique, falls back on the product.
  const mirrored = e[3] === -v[2] && e[7] === -v[6] && e[11] === -v[10] && e[15] === -v[14]
  for (let i = 0; i < 8; i++) {
    const at = from + i * 3,
      x = corners[at],
      y = corners[at + 1],
      z = corners[at + 2]
    const viewZ = transformPointRow(v, 2, x, y, z)
    const vd = affine ? 1 : transformPointRow(v, 3, x, y, z)
    if (-(vd === 1 ? viewZ : viewZ * (1 / vd)) <= near) {
      // The result of a box that clips the near plane reads no corner: nothing to project.
      clipsNear = true
      break
    }
    const cw = mirrored ? -viewZ : transformPointRow(e, 3, x, y, z)
    if (cw <= 0 || !Number.isFinite(cw)) {
      clipsNear = true
      break
    }
    const ndcX = transformPointRow(e, 0, x, y, z) / cw,
      ndcY = transformPointRow(e, 1, x, y, z) / cw,
      ndcZ = transformPointRow(e, 2, x, y, z) / cw
    if (ndcX < lowX) lowX = ndcX
    if (ndcX > highX) highX = ndcX
    if (ndcY < lowY) lowY = ndcY
    if (ndcY > highY) highY = ndcY
    if (ndcZ > nearestZ) nearestZ = ndcZ
    projected++
  }
  if (!projected || clipsNear) {
    into[base] = 0
    into[base + 1] = 0
    into[base + 2] = 0
    into[base + 3] = 0
    into[base + 4] = 0
    into[base + 5] = 1
    return
  }
  // The NDC-to-screen passage is monotonic coordinate by coordinate — increasing in x,
  // decreasing in y: the extremum of the image is the image of the extremum, to the bit. The
  // four conversions happen once per box instead of twenty-four. Depth itself is already in
  // `[0, 1]`: the engine projection never leaves it otherwise (`../camera/depthConvention.ts`).
  into[base] = Math.floor((lowX * 0.5 + 0.5) * width)
  into[base + 1] = Math.floor((1 - (highY * 0.5 + 0.5)) * height)
  into[base + 2] = Math.ceil((highX * 0.5 + 0.5) * width)
  into[base + 3] = Math.ceil((1 - (lowY * 0.5 + 0.5)) * height)
  into[base + 4] = nearestZ
  into[base + 5] = 0
}
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
