import type { SceneLight } from '../../../../../../sdk-core/src/scene/light/contracts.ts'

/**
 * WHAT THE MAIN VIEW COMPUTED, AND WHERE (`world.diagnostic.inspect()`): read once, right after the
 * main view's next image, in world metres, so that a map drawn from above can show it. Nothing of
 * it exists until a page asks: no frame keeps, copies or computes any of it (`./read.ts`).
 */
export interface FrameInspection {
  /** The engine's frame number of the image inspected. */
  frame: number
  /** The camera the image was drawn from. */
  camera: InspectedCamera
  /** The camera the cut was made from: the one held while the cut is frozen
   *  (`world.diagnostic.freeze`), else `camera`. */
  cutCamera: InspectedCamera
  /** Whether the cut was frozen. */
  frozen: boolean
  clusters: InspectedClusters
  /** One record a shadow map the image's shadows read: a sun's clipmap level, a local light's
   *  map. */
  shadows: InspectedShadowMap[]
  /** Where the reflections' rays left from and what they met, sampled; `null` where the image
   *  traces none (no reflection, an orthographic camera). */
  reflections: InspectedReflections | null
  lights: InspectedLight[]
}

/** A camera's frustum in the world. */
export interface InspectedCamera {
  /** Where the eye stands. */
  eye: [number, number, number]
  /** The unit direction the camera looks along. */
  forward: [number, number, number]
  /** The near plane's four corners — left-bottom, right-bottom, right-top, left-top —, three
   *  values each. */
  nearCorners: Float64Array
  /** The unit direction each frustum edge leaves its near corner along, in the same order: a
   *  map draws the edge from the corner as far as it likes, the far plane being at infinity. */
  edges: Float64Array
  near: number
  /** The farthest distance the host declared. */
  far: number
  perspective: boolean
}

/** What the cut decided of a cluster (`InspectedClusters.state`). */
export const CLUSTER_STATE = {
  /** Selected by the cut and drawn. */
  kept: 0,
  /** Selected by the cut, then rejected by the occlusion test: nothing of it was rasterised. */
  occluded: 1,
  /** Selected by the cut but not resident: its coarser ancestor drew in its place. */
  missing: 2,
} as const

/** The clusters of the main view's cut, one rank each across the arrays. */
export interface InspectedClusters {
  count: number
  /** World box of each: least x, y, z then greatest x, y, z. */
  bounds: Float32Array
  /** Its level in the cluster DAG: 0 the finest. */
  level: Uint8Array
  /** One of `CLUSTER_STATE`. */
  state: Uint8Array
  triangles: Uint32Array
  /** Clusters the cut rejected outside the frustum: a count, they are listed nowhere. */
  frustumRejected: number
  /** True when more clusters than `INSPECTION_CLUSTER_CAP` were cut: the arrays hold the first. */
  truncated: boolean
}

/** One shadow map. */
export interface InspectedShadowMap {
  light: string
  kind: SceneLight['kind']
  /** A sun's clipmap level: it spans 2^(level + 3) centimetres a side, 128 pages; 0 for a local
   *  light. */
  level: number
  /** False for the map of a light the view did not see this frame, kept cached. */
  seen: boolean
  /** A sun's pages mapped at this level, four world corners each (twelve values), on the plane
   *  through the level's centre facing the light; a local light's are not placed: none. */
  pages: Float32Array
  /** 1 where the page was drawn this image, 0 where its cached depth served; one per page. */
  rendered: Uint8Array
  /** Pages mapped at this level, and drawn this image: a local light's too. */
  mappedCount: number
  renderedCount: number
  /** A sun's propagation direction, to slide its pages onto any ground; zero for a local light. */
  direction: [number, number, number]
}

/** The reflections' rays, one sample in `stride`² of the grid's texels. */
export interface InspectedReflections {
  count: number
  /** Grid texels a sample stands for, a side: a grid texel is a block of 2 × 2 pixels. */
  stride: number
  /** Where each ray left, on its surface: three values each. */
  origins: Float32Array
  /** Its unit direction: three values each. */
  directions: Float32Array
  /** How far it went before it met something; `Infinity` where it met nothing near. */
  distances: Float32Array
  /** Rays heading back against the view's direction, toward the camera's side of the image plane:
   *  no pixel of the image can answer them, the scene's proxy or the probes must. */
  towardCamera: number
  /** Rays whose hit lies outside the view: the screen could not answer them. */
  offView: number
  /** Rays that met nothing near. */
  missed: number
}

/** One light of the scene. */
export interface InspectedLight {
  id: string
  kind: SceneLight['kind']
  position?: [number, number, number]
  direction?: [number, number, number]
  /** Where its energy vanishes, metres: a point, spot or rect light's reach. */
  range?: number
  castsShadow: boolean
  /** Whether its reach meets the view: a light that does not costs no shadow map. */
  seen: boolean
}

/** The clusters an inspection lists at most. */
export const INSPECTION_CLUSTER_CAP = 1 << 18
/** The reflection samples an inspection reads at most. */
export const INSPECTION_REFLECTION_CAP = 1 << 14
