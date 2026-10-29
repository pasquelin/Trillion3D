import { frustumExcludesBox } from '../../../../../math/src/geometry/frustum/box.ts'

/**
 * THE PLAN OF THE VOXEL GRIDS, on the CPU: the bounds the volumes of a
 * view span, the smallest voxel the grids need, the resolution of the top level of the ortho grid and of the frustum grid, and
 * the near and far planes of the frustum grid. Pure functions of numbers; the passes that fill the grids take their results
 * (`gridBuild.ts`).
 */

type Vec3 = readonly [number, number, number]

/** A volume the grids cover: the world box its bounds make (centre and half sizes), the radius of the sphere round it and the
 *  smallest voxel it asks (its bounds over its resolution, 0.001 at least). */
export interface GridVolume {
  readonly origin: Vec3
  readonly extent: Vec3
  readonly radius: number
  readonly minimumVoxelSize: number
}

/** The view the grids are made for. `planes` are the six inward planes of its frustum (`frustumPlanesFromMatrix`); `right`, `up`
 *  and `forward` the unit axes of the camera in the world; `fovDegrees` the full vertical field of view; `width` and `height` the
 *  view's size in pixels. */
export interface GridView {
  readonly origin: Vec3
  readonly right: Vec3
  readonly up: Vec3
  readonly forward: Vec3
  readonly fovDegrees: number
  readonly width: number
  readonly height: number
  readonly planes: Float64Array
}

/** The settings the plan reads (the reference's cvars, `heterogeneousVolumeOptions.ts`). */
export interface GridSettings {
  readonly maxTraceDistance: number
  readonly downsampleFactor: number
  readonly minimumVoxelSizeInFrustum: number
  readonly minimumVoxelSizeOutsideFrustum: number
  readonly bottomLevelGridResolution: number
  readonly indirectionGrid: boolean
  readonly indirectionGridResolution: number
  readonly frustumGridShadingRate: number
  readonly orthoGrid: boolean
  readonly orthoGridShadingRate: number
  readonly frustumGridDepthSliceCount: number
  readonly farPlaneAutoTransition: boolean
}

/** What a grid is built for: the shading rates in and out of the view, and whether the ortho voxel is sized by its distance from the camera. */
export interface GridBuildOptions {
  readonly shadingRateInFrustum: number
  readonly shadingRateOutOfFrustum: number
  readonly useProjectedPixelSize: boolean
}

/** A box: its centre and half sizes. */
export interface GridBounds {
  readonly origin: Vec3
  readonly extent: Vec3
}

/** The tangent of half a field of view given in degrees. */
export const tanHalfFov = (fovDegrees: number) => Math.tan(((fovDegrees * 0.5) / 180) * Math.PI)

const lengthOf = (v: Vec3) => Math.hypot(v[0], v[1], v[2])
const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** The box that holds `a` and `b`; either may be none. */
export function unionBounds(a: GridBounds | undefined, b: GridBounds): GridBounds {
  if (!a) return { origin: b.origin, extent: b.extent }
  const side = (i: 0 | 1 | 2) => {
    const min = Math.min(a.origin[i] - a.extent[i], b.origin[i] - b.extent[i])
    const max = Math.max(a.origin[i] + a.extent[i], b.origin[i] + b.extent[i])
    return [(min + max) / 2, (max - min) / 2] as const
  }
  const [x, y, z] = [side(0), side(1), side(2)]
  return { origin: [x[0], y[0], z[0]], extent: [x[1], y[1], z[1]] }
}

/** Whether the box meets the view's frustum (`FConvexVolume::IntersectBox`). */
export const meetsFrustum = (view: GridView, box: GridBounds) =>
  !frustumExcludesBox(
    view.planes,
    box.origin[0] - box.extent[0],
    box.origin[1] - box.extent[1],
    box.origin[2] - box.extent[2],
    box.origin[0] + box.extent[0],
    box.origin[1] + box.extent[1],
    box.origin[2] + box.extent[2],
  )

/** The world width of a pixel one metre from the camera, at the volumes' downsample (`PixelWidth`). */
const pixelWidth = (view: GridView, s: GridSettings) =>
  tanHalfFov(view.fovDegrees) / ((view.width * 0.5) / s.downsampleFactor)

/**
 * The bounds the volumes in the view span and the smallest voxel they ask, bandlimited by the voxel the shading rate projects at
 * their distance (`CalcViewBoundsAndMinimumVoxelSize`, the frustum grid's). The bounds are none while no volume meets the frustum.
 */
export function viewBoundsAndMinimumVoxelSize(
  view: GridView,
  volumes: readonly GridVolume[],
  options: GridBuildOptions,
  s: GridSettings,
) {
  let bounds: GridBounds | undefined
  let minimumVoxelSize = s.minimumVoxelSizeOutsideFrustum
  const width = pixelWidth(view, s)
  for (const volume of volumes) {
    if (!meetsFrustum(view, volume)) continue
    bounds = unionBounds(bounds, volume)
    const away = Math.max(distance(volume.origin, view.origin) - lengthOf(volume.extent), 0)
    const voxelWidth = away * width * options.shadingRateInFrustum
    minimumVoxelSize = Math.min(Math.max(voxelWidth, volume.minimumVoxelSize), minimumVoxelSize)
  }
  return { bounds, minimumVoxelSize }
}

/**
 * The bounds of every volume of every view and the smallest voxel any asks (`CalcGlobalBoundsAndMinimumVoxelSize`, the ortho grid's):
 * a volume in a view's frustum asks the in-frustum shading rate, else the out-of-frustum one, times its distance from the
 * camera when the voxel is projected; a view whose volumes meet its frustum is held to the in-frustum smallest voxel then.
 */
export function globalBoundsAndMinimumVoxelSize(
  views: readonly GridView[],
  volumes: readonly GridVolume[],
  options: GridBuildOptions,
  s: GridSettings,
) {
  let bounds: GridBounds | undefined
  let globalMinimum = s.minimumVoxelSizeOutsideFrustum
  for (const view of views) {
    let viewMinimum = s.minimumVoxelSizeOutsideFrustum
    let aggregate: GridBounds | undefined
    const width = pixelWidth(view, s)
    for (const volume of volumes) {
      aggregate = unionBounds(aggregate, volume)
      let voxelWidth = meetsFrustum(view, volume)
        ? options.shadingRateInFrustum
        : options.shadingRateOutOfFrustum
      if (options.useProjectedPixelSize)
        voxelWidth *= Math.max(distance(volume.origin, view.origin) - volume.radius, 0) * width
      viewMinimum = Math.min(Math.max(voxelWidth, volume.minimumVoxelSize), viewMinimum)
    }
    if (!aggregate) continue
    if (options.useProjectedPixelSize && meetsFrustum(view, aggregate))
      viewMinimum = Math.max(viewMinimum, s.minimumVoxelSizeInFrustum)
    bounds = unionBounds(bounds, aggregate)
    globalMinimum = Math.min(globalMinimum, viewMinimum)
  }
  return { bounds, minimumVoxelSize: globalMinimum }
}

/** The cells along a side of the ortho grid's top level: the bounds over the voxels one top-level cell holds at the smallest voxel,
 *  held to 128 a side, 256 deep (`CalculateTopLevelGridResolution`). */
export function topLevelGridResolution(
  bounds: GridBounds,
  globalMinimumVoxelSize: number,
  s: GridSettings,
): [number, number, number] {
  const combined =
    s.bottomLevelGridResolution * (s.indirectionGrid ? s.indirectionGridResolution : 1)
  const cell = combined * globalMinimumVoxelSize
  const side = (i: 0 | 1 | 2, limit: number) =>
    Math.min(Math.max(Math.ceil((bounds.extent[i] * 2) / cell), 1), limit)
  return [side(0, 128), side(1, 128), side(2, 256)]
}

/**
 * The near and far distances of the frustum grid along the view direction: a negative one takes the distance at which the sphere of the
 * bounds begins or ends, the near held to 0.01 or more and the far to one past the sphere's near (`ClipNearFarDistances`).
 */
export function clipNearFarDistances(
  view: GridView,
  bounds: GridBounds,
  near: number,
  far: number,
) {
  const d = -(
    view.forward[0] * view.origin[0] +
    view.forward[1] * view.origin[1] +
    view.forward[2] * view.origin[2]
  )
  const signed =
    view.forward[0] * bounds.origin[0] +
    view.forward[1] * bounds.origin[1] +
    view.forward[2] * bounds.origin[2] +
    d
  const radius = lengthOf(bounds.extent)
  const nearDistance = signed - radius
  const farDistance = signed + radius
  const clippedNear = Math.max(near < 0 ? nearDistance : near, 0.01)
  return { near: clippedNear, far: Math.max(far < 0 ? farDistance : far, nearDistance + 1) }
}

/**
 * The cells of the frustum grid's top level, and the far plane it ends at: the view cut into voxels of the shading rate, the depth into
 * slices no thinner than the smallest voxel, each side over the bottom level's cells (`CalculateTopLevelGridResolutionForFrustumGrid`).
 * Where the ortho grid takes over the far field (`FarPlaneAutoTransition`), the far plane stops at the distance a pixel spans the
 * smallest voxel.
 */
export function frustumGridResolution(
  view: GridView,
  minimumVoxelSize: number,
  near: number,
  far: number,
  s: GridSettings,
) {
  const bottom = s.bottomLevelGridResolution
  const rate = s.frustumGridShadingRate
  const width = Math.ceil(view.width / rate)
  const height = Math.ceil(view.height / rate)
  let farPlane = far
  if (s.orthoGrid && s.farPlaneAutoTransition && rate >= s.orthoGridShadingRate) {
    const globalMinimum = Math.max(minimumVoxelSize, s.minimumVoxelSizeInFrustum)
    const theta = ((view.fovDegrees * 0.5) / 180) * Math.PI
    farPlane = Math.min(farPlane, globalMinimum / Math.tan((2 * theta) / width))
  }
  const maxDepth = Math.ceil((farPlane - near) / minimumVoxelSize)
  const depth = Math.min(Math.ceil(s.frustumGridDepthSliceCount / rate), maxDepth)
  const cells = (n: number) => Math.max(Math.ceil(n / bottom), 1)
  return {
    resolution: [cells(width), cells(height), cells(depth)] as [number, number, number],
    far: farPlane,
  }
}

/** The view space of the frustum grid (x right, y up, z the distance along the view) to the world, column-major. */
export function frustumGridViewToWorld(view: GridView): Float64Array {
  const { right, up, forward, origin } = view
  return Float64Array.from([...right, 0, ...up, 0, ...forward, 0, ...origin, 1])
}

/**
 * The five planes of the view's frustum, outward (a point beyond one has a positive distance), in the world: the near plane and the four
 * sides, the far one left out as the far corners are 1e-6 of the way to infinity.
 * `corners` are the eight world corners of the frustum, the near four then the far four, each as left-bottom, right-bottom, left-top,
 * right-top. Each plane is a four-vector `(normal, d)`.
 */
export function outwardFrustumPlanes(corners: readonly Vec3[]): Float32Array {
  const centre = [0, 1, 2].map((i) => corners.reduce((sum, c) => sum + c[i], 0) / 8)
  const plane = (a: Vec3, b: Vec3, c: Vec3) => {
    const x = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const y = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    let n = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]
    const len = Math.hypot(n[0], n[1], n[2])
    n = n.map((v) => v / len)
    let d = -(n[0] * a[0] + n[1] * a[1] + n[2] * a[2])
    // Outward: the centre of the frustum is behind it.
    if (n[0] * centre[0] + n[1] * centre[1] + n[2] * centre[2] + d > 0) {
      n = n.map((v) => -v)
      d = -d
    }
    return [...n, d]
  }
  const [lb, rb, lt, rt, flb, frb, flt, frt] = corners
  return Float32Array.from([
    ...plane(lb, rb, lt),
    ...plane(rb, rt, frb),
    ...plane(lt, flt, rt),
    ...plane(lb, flb, lt),
    ...plane(lb, rb, flb),
  ])
}

/** The eight world corners of a view's frustum from the inverse of its view-projection (column-major): the near four then the far four,
 *  each as left-bottom, right-bottom, left-top, right-top. The depth is reversed: 1 at the near plane, `farDepth` (a hair over 0, as the
 *  far plane is at infinity) at the far. */
export function viewFrustumCorners(
  inverseViewProjection: ArrayLike<number>,
  farDepth = 1e-6,
): Vec3[] {
  const m = inverseViewProjection
  const at = (x: number, y: number, z: number): Vec3 => {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15]
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
    ]
  }
  const ring = (z: number) => [at(-1, -1, z), at(1, -1, z), at(-1, 1, z), at(1, 1, z)]
  return [...ring(1), ...ring(farDepth)]
}
