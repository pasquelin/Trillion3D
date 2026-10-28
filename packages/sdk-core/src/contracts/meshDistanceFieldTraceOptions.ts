import {
  countSetting as count,
  flagSetting as flag,
  nonNegativeSetting as nonNegative,
  positiveSetting as positive,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * The software trace of the indirect light and the reflections through the meshes' own distance fields
 * (`packages/sdk-browser/src/lighting/rays/meshTrace/`), in place of the global distance field alone
 * (`./globalDistanceFieldOptions.ts`) over the first stretch of each ray. It is more exact, and costs more where
 * meshes overlap. The view's meshes are culled to a grid of cells along the screen and the depth, each ray of a
 * pixel marching through the meshes its cell lists; the global field takes the ray over past
 * `meshDistanceFieldTraceDistance`. Each setting is the reference's console variable of the name in the parentheses,
 * with its default; lengths are in the reference's unit, the centimetre.
 * - `meshDistanceFieldTrace` (`r.…TraceMeshSDFs`, off) and `meshDistanceFieldTraceAllow`
 *   (`r.…TraceMeshSDFs.Allow`, on, the quality's): whether the rays trace the meshes' fields; both must hold.
 *   `meshDistanceFieldDetailTraces` (the show flag of the detail traces, on) is the view's own switch;
 * - `screenProbeMeshDistanceFieldTrace` (`r.…ScreenProbeGather.TraceMeshSDFs`, on),
 *   `reflectionMeshDistanceFieldTrace` (`r.…Reflections.TraceMeshSDFs`, on, the opaque rays only) and
 *   `directLightingMeshDistanceFieldTrace` (`r.…Scene.DirectLighting.OffscreenShadowing.TraceMeshSDFs`, on):
 *   whether the screen probes' rays, the reflections' and the surface cache's shadow rays use them;
 * - `meshDistanceFieldTraceDistance` (`r.…TraceMeshSDFs.TraceDistance`, 180 cm): the farthest a ray traces the
 *   meshes' fields, also how far a mesh's field is reached past its bounds when the view is culled;
 * - `meshDistanceFieldTraceEndDistance` (`r.…DiffuseIndirect.CardTraceEndDistanceFromCamera`, 4000 cm): the
 *   farthest from the camera a mesh is traced at;
 * - `meshDistanceFieldTraceAverageCulledCount` (`r.…DiffuseIndirect.MeshSDF.AverageCulledCount`, 512): the
 *   meshes a cell of the grid is expected to hold, which sizes the lists;
 * - `meshDistanceFieldTraceRadiusThreshold` (`r.…DiffuseIndirect.MeshSDF.RadiusThreshold`, 30 cm): a mesh whose
 *   bounding sphere is smaller, unless it emits light, is left out, the radius divided by the view's scene detail;
 * - `meshDistanceFieldTraceNotCoveredExpandSurfaceScale` (`...MeshSDF.NotCoveredExpandSurfaceScale`, 0.6),
 *   `meshDistanceFieldTraceNotCoveredMinStepScale` (`...MeshSDF.NotCoveredMinStepScale`, 32) and
 *   `meshDistanceFieldTraceDitheredTransparencyStepThreshold` (`...MeshSDF.DitheredTransparencyStepThreshold`, 0.1):
 *   for a mesh that is mostly two-sided (foliage), the scale of the surface's expansion, of the least step, and the
 *   noise under which a dithered ray is stopped at each step;
 * - `meshDistanceFieldTraceCullGridPixelSize` (`r.…DiffuseIndirect.CullGridPixelSize`, 64): the pixels along a cell
 *   of the grid, a power of two; `meshDistanceFieldTraceCullGridLogZScale` (`...CullGridDistributionLogZScale`, 0.01),
 *   `meshDistanceFieldTraceCullGridLogZOffset` (`...CullGridDistributionLogZOffset`, 1) and
 *   `meshDistanceFieldTraceCullGridZScale` (`...CullGridDistributionZScale`, 4): how the depth is cut into slices.
 */
export const MESH_DISTANCE_FIELD_TRACE_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('meshDistanceFieldTrace', false),
    flag('meshDistanceFieldTraceAllow', true),
    flag('meshDistanceFieldDetailTraces', true),
    flag('screenProbeMeshDistanceFieldTrace', true),
    flag('reflectionMeshDistanceFieldTrace', true),
    flag('directLightingMeshDistanceFieldTrace', true),
    nonNegative('meshDistanceFieldTraceDistance', 180),
    nonNegative('meshDistanceFieldTraceEndDistance', 4000),
    count('meshDistanceFieldTraceAverageCulledCount', 512, 1),
    nonNegative('meshDistanceFieldTraceRadiusThreshold', 30),
    nonNegative('meshDistanceFieldTraceNotCoveredExpandSurfaceScale', 0.6),
    nonNegative('meshDistanceFieldTraceNotCoveredMinStepScale', 32),
    nonNegative('meshDistanceFieldTraceDitheredTransparencyStepThreshold', 0.1),
    count('meshDistanceFieldTraceCullGridPixelSize', 64, 1),
    positive('meshDistanceFieldTraceCullGridLogZScale', 0.01),
    nonNegative('meshDistanceFieldTraceCullGridLogZOffset', 1),
    nonNegative('meshDistanceFieldTraceCullGridZScale', 4),
  ] as const))()

/** The fields of the meshes' fields trace's settings. */
export type MeshDistanceFieldTraceField = keyof typeof MESH_DISTANCE_FIELD_TRACE_RULES

/** What a host writes for the meshes' fields trace: any of its fields. */
export type MeshDistanceFieldTraceOptions = SettingOptions<typeof MESH_DISTANCE_FIELD_TRACE_RULES>

/** The meshes' fields trace's settings as resolved. */
export type MeshDistanceFieldTraceValues = SettingValues<typeof MESH_DISTANCE_FIELD_TRACE_RULES>

/** What the passes read of the settings. */
export interface MeshDistanceFieldTraceSettings {
  /** Whether the rays trace the meshes' fields at all: the switch, the quality's allowance and the view's detail flag. */
  enabled: boolean
  /** Whether the screen probes' rays, the reflections' (opaque) and the surface cache's shadow rays do. */
  screenProbes: boolean
  reflections: boolean
  directLighting: boolean
  traceDistance: number
  endDistance: number
  averageCulledCount: number
  radiusThreshold: number
  notCoveredExpandSurfaceScale: number
  notCoveredMinStepScale: number
  ditheredTransparencyStepThreshold: number
  /** The pixels along a cell of the grid, rounded down to a power of two (the reference shifts by its base 2 logarithm). */
  cullGridPixelSize: number
  cullGridLogZScale: number
  cullGridLogZOffset: number
  cullGridZScale: number
}

/** The largest power of two that does not exceed the whole number `n` of at least 1. */
const powerOfTwoBelow = (n: number) => 2 ** Math.floor(Math.log2(n))

/** The trace's numbers from its resolved values (`MeshDistanceFieldTraceValues`). */
export function resolveMeshDistanceFieldTrace(
  values: MeshDistanceFieldTraceValues,
): MeshDistanceFieldTraceSettings {
  return {
    enabled:
      values.meshDistanceFieldTrace &&
      values.meshDistanceFieldTraceAllow &&
      values.meshDistanceFieldDetailTraces,
    screenProbes: values.screenProbeMeshDistanceFieldTrace,
    reflections: values.reflectionMeshDistanceFieldTrace,
    directLighting: values.directLightingMeshDistanceFieldTrace,
    traceDistance: values.meshDistanceFieldTraceDistance,
    endDistance: values.meshDistanceFieldTraceEndDistance,
    averageCulledCount: values.meshDistanceFieldTraceAverageCulledCount,
    radiusThreshold: values.meshDistanceFieldTraceRadiusThreshold,
    notCoveredExpandSurfaceScale: values.meshDistanceFieldTraceNotCoveredExpandSurfaceScale,
    notCoveredMinStepScale: values.meshDistanceFieldTraceNotCoveredMinStepScale,
    ditheredTransparencyStepThreshold:
      values.meshDistanceFieldTraceDitheredTransparencyStepThreshold,
    cullGridPixelSize: powerOfTwoBelow(values.meshDistanceFieldTraceCullGridPixelSize),
    cullGridLogZScale: values.meshDistanceFieldTraceCullGridLogZScale,
    cullGridLogZOffset: values.meshDistanceFieldTraceCullGridLogZOffset,
    cullGridZScale: values.meshDistanceFieldTraceCullGridZScale,
  }
}
