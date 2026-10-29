/**
 * THE CONTINUOUS LEVEL OF DETAIL OF A VOLUME (`CalcLOD`, `HeterogeneousVolumes.cpp:801-871`): how many times coarser than its own resolution a
 * volume may be sampled from where the view sees it. The level is the log of the volume's smallest side in voxels over the pixels its bounds cover,
 * held between 0 and the coarsest level (the log of that side), and 2 to the level plus the bias is the factor the lighting cache, the occlusion, the
 * baked grid and the march's steps are made coarser by. A volume outside the view's frustum takes the coarsest level.
 */

/** What the level reads of the view. */
export interface LodView {
  readonly eye: ArrayLike<number>
  /** The view-projection matrix, column-major, from which the frustum's sides are taken. */
  readonly viewProjection: ArrayLike<number>
  /** The tangent of half the horizontal field of view; half the width the view covers, in world units, for an orthographic one (`orthographic`). */
  readonly tanHalfFov: number
  /** Whether the view is orthographic: a pixel is as wide at any distance, `tanHalfFov` over half the view's width in pixels (the reference treats such a
   *  view as a perspective one, `HeterogeneousVolumes.cpp:856`, and reads the nominal field of view). */
  readonly orthographic?: boolean
  /** The view's width in pixels, and the factor the volumes' image is downsampled by. */
  readonly viewWidth: number
  readonly downsample: number
  readonly near: number
}

/** A volume's world bounds: the box (its centre and half extents) and the radius of its sphere. */
export interface LodBounds {
  readonly origin: readonly [number, number, number]
  readonly extent: readonly [number, number, number]
  readonly radius: number
}

/** The level and the bias a volume is given. */
export interface LodValue {
  readonly lod: number
  readonly bias: number
}

/** The level of detail of a volume of no detail: the volume's own resolution. */
export const NO_LOD: LodValue = { lod: 0, bias: 0 }

/** The factor a level and a bias make the volume coarser by (`CalcLODFactor`, `:877`). */
export const lodFactor = (value: LodValue) => 2 ** (value.lod + value.bias)

/** The factor for the level alone, the bias left out (the lighting cache's and the occlusion's resolution, `:892`). */
export const lodFactorOfLevel = (value: LodValue) => 2 ** value.lod

/** The world bounds of a box (centre and half extents in the volume's local space) carried by `toWorld`, column-major. */
export function worldBoundsOf(
  toWorld: ArrayLike<number>,
  centre: readonly number[],
  extent: readonly number[],
): LodBounds {
  const origin = [0, 1, 2].map(
    (r) =>
      toWorld[r] * centre[0] +
      toWorld[4 + r] * centre[1] +
      toWorld[8 + r] * centre[2] +
      toWorld[12 + r],
  )
  const half = [0, 1, 2].map(
    (r) =>
      Math.abs(toWorld[r]) * extent[0] +
      Math.abs(toWorld[4 + r]) * extent[1] +
      Math.abs(toWorld[8 + r]) * extent[2],
  )
  const scale = Math.sqrt(
    Math.max(...[0, 4, 8].map((c) => toWorld[c] ** 2 + toWorld[c + 1] ** 2 + toWorld[c + 2] ** 2)),
  )
  return {
    origin: origin as [number, number, number],
    extent: half as [number, number, number],
    radius: Math.hypot(extent[0], extent[1], extent[2]) * scale,
  }
}

/** Whether the box meets the view's frustum: against the four sides taken from the view-projection matrix (the depth planes are left out: the far plane is
 *  at infinity and the volume is drawn from the near one). */
function inFrustum(m: ArrayLike<number>, bounds: LodBounds) {
  const rows = [3, 0, 1].map((r) => [m[r], m[4 + r], m[8 + r], m[12 + r]])
  const planes = [
    rows[0].map((v, i) => v + rows[1][i]),
    rows[0].map((v, i) => v - rows[1][i]),
    rows[0].map((v, i) => v + rows[2][i]),
    rows[0].map((v, i) => v - rows[2][i]),
  ]
  return planes.every((p) => {
    const reach =
      Math.abs(p[0]) * bounds.extent[0] +
      Math.abs(p[1]) * bounds.extent[1] +
      Math.abs(p[2]) * bounds.extent[2]
    return (
      p[0] * bounds.origin[0] + p[1] * bounds.origin[1] + p[2] * bounds.origin[2] + p[3] + reach >=
      0
    )
  })
}

/**
 * The level of detail of a volume seen by `view`: none (`NO_LOD`) where the continuous level of detail is off; else the level the pixels its
 * bounds cover give, and the bias, the volume's streaming bias and `bias` held below the coarsest level.
 */
export function calcLod(c: {
  view: LodView
  bounds: LodBounds
  /** The smallest side of the volume, in voxels. */
  voxelsMin: number
  /** The volume's mip bias (`streamingMipBias`) and the setting's bias. */
  mipBias: number
  bias: number
  enabled: boolean
}): LodValue {
  if (!c.enabled) return NO_LOD
  const { view, bounds } = c
  const maxLod = Math.floor(Math.log2(c.voxelsMin))
  let lod = maxLod
  if (inFrustum(view.viewProjection, bounds)) {
    // The pixel width at the nearest distance of the volume's bounds, and the pixels its widest side covers.
    const pixelWidth = view.tanHalfFov / ((view.viewWidth * 0.5) / view.downsample)
    const distance = view.orthographic
      ? 1
      : Math.max(
          Math.hypot(
            bounds.origin[0] - view.eye[0],
            bounds.origin[1] - view.eye[1],
            bounds.origin[2] - view.eye[2],
          ) - bounds.radius,
          view.near,
        )
    const coverage = (2 * Math.max(...bounds.extent)) / (distance * pixelWidth)
    lod = Math.min(Math.max(Math.log2(c.voxelsMin / coverage), 0), maxLod)
  }
  return { lod, bias: Math.min(c.mipBias + c.bias, maxLod - lod) }
}
