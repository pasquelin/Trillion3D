/**
 * The settings of an `approximate` layer and of a `simplify` layer as a host writes them
 * (`hlodLayerAbi.ts` holds the layer that carries them; `hlodAbi.ts` the values they name).
 */
import type {
  HlodBaseCapping,
  HlodGroundClipping,
  HLOD_NORMAL_METHODS,
  HLOD_TRANSFER_RAYS,
} from './hlodAbi.ts'

/** An `approximate` layer's settings beyond its voxel, deviation and atlas: every step of the
 *  closed shell and of its bake, each its default when left out. Lengths in metres; a multiplier
 *  is a count of the layer's voxels (`accuracy`). */
export interface HlodApproximation {
  /** The most voxels across the bounds' diagonal, from 64 to 1290. @defaultValue 1024 */
  voxelClamp?: number
  /** Whether a thin part is thickened by a shell. @defaultValue true */
  autoThicken?: boolean
  /** The thickness a thin part is brought to, in voxels. @defaultValue 1.5 */
  thicknessMultiplier?: number
  /** Whether a tiny thin part is dropped. @defaultValue true */
  ignoreTinyParts?: boolean
  /** The size a thin part is tiny under, in voxels, 0.001 or more. @defaultValue 0.05 */
  tinyPartMultiplier?: number
  /** The winding number past which a point is inside, from 0.01 to 0.99. @defaultValue 0.5 */
  windingThreshold?: number
  /** Whether the gaps are closed by a morphological closing. @defaultValue true */
  fillGaps?: boolean
  /** The widest gap closed, metres. @defaultValue 0.1 */
  gapDistance?: number
  /** Which hidden triangles are dropped: those no ray from outside reaches, or none.
   *  @defaultValue 'visibility' */
  occlusion?: 'visibility' | 'none'
  /** Whether a floor under the shell hides what only faces down. @defaultValue true */
  occludeFromBelow?: boolean
  /** What the shell is simplified to: the layer's `deviation`, `trianglesPerSquareMetre` of its
   *  area, or `triangleCount` triangles. @defaultValue 'geometricTolerance' */
  simplification?: 'geometricTolerance' | 'trianglesPerArea' | 'fixedTriangleCount'
  /** The triangles a `fixedTriangleCount` shell keeps, from 16 to 2147483647. @defaultValue 2000 */
  triangleCount?: number
  /** The triangles a `trianglesPerArea` shell keeps per square metre, from 0.01 to the largest
   *  single-precision number. @defaultValue 2 */
  trianglesPerSquareMetre?: number
  /** Whether a fast collapse pass goes first on a dense shell. @defaultValue true */
  simplifyPrePass?: boolean
  /** Whether faces turning past `hardNormalAngle` get separate normals; otherwise one normal a
   *  vertex. @defaultValue true */
  hardNormals?: boolean
  /** The crease angle, degrees, from 0 to 90. @defaultValue 60 */
  hardNormalAngle?: number
  /** How the shell is unwrapped: charts grown by cost and flattened conformally, patches merged
   *  into islands, or charts cut by spectral analysis of the surface. @defaultValue 'charts' */
  uvMethod?: 'charts' | 'patches' | 'uvAtlas'
  /** The most stretch the `uvAtlas` charts may reach, from 0 (none) to 1 (any). @defaultValue 0.1 */
  uvAtlasStretch?: number
  /** The `patches` unwrap's initial patch count, from 1 to 99999999. @defaultValue 250 */
  initialPatches?: number
  /** The `patches` unwrap's weight of the normal's turn, from 0.01 to 100. @defaultValue 1 */
  curvatureAlignment?: number
  /** The `patches` unwrap's area distortion an island may reach, at least 1. @defaultValue 1.5 */
  mergingThreshold?: number
  /** The `patches` unwrap's normal deviation, degrees, two merged patches may differ by, from 0
   *  to 180. @defaultValue 45 */
  maxAngleDeviation?: number
  /** Each view's side the bake reads the sources from, pixels, up to 16384; 0 the atlas side.
   *  @defaultValue 2048 */
  captureResolution?: number
  /** Each view's horizontal field of view, degrees, from 5 to 160. @defaultValue 30 */
  captureFieldOfView?: number
  /** Each view's near plane, metres, from 0.00001 to 10. @defaultValue 0.01 */
  nearPlane?: number
  /** The atlas baked this many times larger per side, then averaged down; 0 or 1 none, at most 8.
   *  @defaultValue 0 */
  multiSampling?: number
  /** The most samples a view's texture read takes along its footprint's longer side — the views'
   *  sampler anisotropy —, 1 to 16. @defaultValue 8 */
  captureAnisotropy?: number
  /** The images baked beside the base colour: the normal map; the roughness, metallic and
   *  specular, packed in one image (R, G and B); the emission. A channel not baked takes the
   *  constant roughness 0.5 or metallic 0.
   *  @defaultValue { normal: true, roughness: false, metallic: false, specular: false, emissive: false } */
  maps?: {
    normal?: boolean
    roughness?: boolean
    metallic?: boolean
    specular?: boolean
    emissive?: boolean
  }
  /** How the scene's base is closed before the solid is read (`HLOD_BASE_CAPPINGS`); `true` the
   *  default, `false` `none`. @defaultValue `DEFAULT_HLOD_BASE_CAPPING` */
  baseCapping?: HlodBaseCapping | boolean
  /** The height above the scene's lowest point whose vertices the base cap hulls, metres, 0 or
   *  more; 0 twice the layer's `accuracy`. @defaultValue 0 */
  baseHeight?: number
  /** A `convexSolid` cap's thickness, metres, 0 or more; 0 the thickening's thickness when
   *  `autoThicken`, else 1.25 times the layer's `accuracy`. @defaultValue 0 */
  baseThickness?: number
  /** How a horizontal plane at `groundHeight` clips the shell (`HLOD_GROUND_CLIPPINGS`); `true` the
   *  default, `false` `none`. @defaultValue `DEFAULT_HLOD_GROUND_CLIPPING` */
  groundClipping?: HlodGroundClipping | boolean
  /** The ground plane's height, the world's up coordinate, metres. @defaultValue 0 */
  groundHeight?: number
  /** Whether each source mesh is read as its vertex buffers hold it, its vertices split where its
   *  attributes are, rather than welded by position. @defaultValue false */
  useRenderLODMeshes?: boolean
}

/** A `simplify` layer's own settings, its `simplification`, each its default when left out.
 *  Lengths in metres. */
export interface HlodSimplifySettings {
  /** The voxel the sources are sampled on, at least 0.001; none derives it from the screen size
   *  the actor is first drawn at: the bounds' largest side over that pixel count, held from 50 to
   *  900, times 0.65. */
  voxel?: number
  /** The widest gap closed between the sources: their volume dilated by half of it, then eroded
   *  back. @defaultValue 0 */
  gapWidth?: number
  /** The base colour, sRGB bytes, of a texel the transfer finds no source for.
   *  @defaultValue [0, 0, 0] */
  unresolvedColor?: [number, number, number]
  /** How far a transfer ray looks for the sources; none for six voxels. Never under a voxel nor
   *  past the bounds' largest side. */
  transferDistance?: number
  /** The angle, degrees from 0 to 180, two faces split their vertices past; `true` 130, `false` or
   *  none no split. @defaultValue false */
  hardAngle?: number | boolean
  /** How the vertex normals weigh their faces (`HLOD_NORMAL_METHODS`).
   *  @defaultValue 'angleWeighted' */
  normalMethod?: (typeof HLOD_NORMAL_METHODS)[number]
  /** The most dilation steps, each way, the gap closing takes on the sources' own grid before it
   *  steps on a coarser one, from 0 (no closing) to 64. @defaultValue 7 */
  gapSteps?: number
  /** How a transfer ray picks its hit (`HLOD_TRANSFER_RAYS`). @defaultValue 'nearest' */
  transferRays?: (typeof HLOD_TRANSFER_RAYS)[number]
  /** Whether faces the simplification folded into one another — an edge of one crossing another
   *  facing the other way — are pushed apart, each a seventh of a voxel along its normal.
   *  @defaultValue false */
  separateFoldedWalls?: boolean
  /** Whether the simplification runs as one pass over the whole mesh rather than in slabs first.
   *  @defaultValue false */
  serialSimplify?: boolean
}
