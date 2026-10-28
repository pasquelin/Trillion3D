import type { MeshDistanceFieldTraceField } from '../contracts/meshDistanceFieldTraceOptions.ts'

/** What each setting of the meshes' fields trace means (`../contracts/meshDistanceFieldTraceOptions.ts`). The defaults and the ranges are the schema's own; lengths are centimetres. */
export const MESH_DISTANCE_FIELD_TRACE_MEANINGS: Readonly<
  Record<MeshDistanceFieldTraceField, string>
> = {
  meshDistanceFieldTrace:
    "Whether the rays of the indirect light and the reflections march the meshes' own distance fields over the first stretch of each ray, in place of the global distance field alone (off by default): more exact, and dearer where meshes overlap.",
  meshDistanceFieldTraceAllow:
    "The quality's allowance of the meshes' fields trace (on by default): the trace runs only where this and meshDistanceFieldTrace are both on.",
  meshDistanceFieldDetailTraces: "The view's own switch of the detail traces (on by default).",
  screenProbeMeshDistanceFieldTrace:
    "Whether the screen probes' rays march the meshes' fields (on by default, where the trace is on).",
  reflectionMeshDistanceFieldTrace:
    "Whether the opaque reflections' rays march the meshes' fields (on by default, where the trace is on).",
  directLightingMeshDistanceFieldTrace:
    "Whether the surface cache's shadow rays march the meshes' fields (on by default, where the trace is on).",
  meshDistanceFieldTraceDistance:
    "The farthest a ray marches the meshes' fields, in centimetres (180 by default), also how far a mesh's field is reached past its bounds when the view is culled; the global distance field takes the ray over from there.",
  meshDistanceFieldTraceEndDistance:
    'The farthest from the camera a mesh is marched at, in centimetres (4000 by default); a ray from a surface nearer than a sixth of it is whole, then fades to none at it.',
  meshDistanceFieldTraceAverageCulledCount:
    'The meshes a cell of the view grid is expected to list (512 by default), which sizes the lists.',
  meshDistanceFieldTraceRadiusThreshold:
    "The radius, in centimetres (30 by default), under which a mesh's bounding sphere leaves it out of the grid unless it emits light, divided by the view's scene detail.",
  meshDistanceFieldTraceNotCoveredExpandSurfaceScale:
    "For a mesh that is mostly two-sided (foliage), the scale of the surface's expansion (0.6 by default).",
  meshDistanceFieldTraceNotCoveredMinStepScale:
    'For a mesh that is mostly two-sided, the scale of the least step (32 by default).',
  meshDistanceFieldTraceDitheredTransparencyStepThreshold:
    'For a mesh that is mostly two-sided, the noise under which a dithered ray is stopped at each step (0.1 by default).',
  meshDistanceFieldTraceCullGridPixelSize:
    'The pixels along a cell of the view grid the meshes are culled to (64 by default), rounded down to a power of two.',
  meshDistanceFieldTraceCullGridLogZScale:
    "The scale of the logarithm of the depth in the grid's slices (0.01 by default).",
  meshDistanceFieldTraceCullGridLogZOffset:
    "The offset of the logarithm of the depth in the grid's slices (1 by default).",
  meshDistanceFieldTraceCullGridZScale:
    'The slices of the grid for each doubling of the depth (4 by default).',
}
