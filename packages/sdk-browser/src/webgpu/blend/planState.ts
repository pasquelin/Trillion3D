import { FRUSTUM_PLANE_VALUES } from '../../../../math/src/geometry/frustum/frustum.ts'
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'
import type { BlendExpand } from './expand.ts'
import type { BlendKernels } from './expandKernels.ts'

/** The plan's expansion, its sizes and regions, and what moves the GPU's frustum verdict. */
export function planState() {
  return {
    /** Kernel that expands the sorted plan, and the two buffers it writes: the instance list the
     *  shader reads, and one indirect argument per run. */
    expand: undefined as BlendExpand | undefined,
    /** The kernels the expansion is mounted on, compiled once whatever the items the session holds. */
    kernels: undefined as BlendKernels | undefined,
    expandedBuffer: undefined as GPUBuffer | undefined,
    argsBuffer: undefined as GPUBuffer | undefined,
    /** What the vertex index shifts to name the first instance of its run, and the vertices of a
     *  paged cluster — the stride of every shared run. */
    vertexShift: 2,
    maxVertexWords: 3,
    /** Instances the scene can expand, and where each pass starts its own. */
    instanceCapacity: 1,
    instanceBase: [0, 0],
    /** Plan entries a pass can carry at most, and the regions each occupies in the plan and
     *  argument buffers (`planLayout.ts`). */
    maxPlanEntries: 1,
    planRegions: [] as { seeds: number; order: number; runs: number; args: number }[],
    /** What the GPU verdict reads moved this many times (`expansionFrame.ts`): its counts come
     *  back under it, and a count read under the current one still holds. */
    verdictEpoch: 0,
    /** The frustum planes the last verdict judged with. */
    judgedPlanes: new Float64Array(FRUSTUM_PLANE_VALUES),
  }
}

/** What the plan counts and draws, built with it, and the paged items' group. */
export function planTotals() {
  return {
    /** Triangles unpaged items submit in each pass, twice for a double-sided item: a scene count,
     *  built with the plan, not a frame count. */
    blendTriangles: 0,
    transmissionTriangles: 0,
    /** A blend of the plan filters the display value (`filtersDisplay`), built with the plan. */
    filtersDisplay: false,
    /** The blending modes the plan draws, built with it: what a later change must compile for. */
    planModes: [] as Blending[],
    /** Bind group ALL paged items share, by identity slot. */
    pagedGroups: [] as (GPUBindGroup | undefined)[],
  }
}
