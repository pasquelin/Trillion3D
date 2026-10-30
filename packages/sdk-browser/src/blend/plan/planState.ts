import { planRegion } from './planLayout.ts'
import { viewState } from '../expand/expansionViews.ts'
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'
import type { BlendExpand } from '../expand/expand.ts'
import type { BlendKernels } from '../expand/expandKernels.ts'

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
    /** Instances the scene can expand in one view, and the blocks of the instance list the buffer holds (`instanceBlocks`). */
    instanceCapacity: 1,
    instanceBlocks: 1,
    /** Plan entries the pass can carry at most, and the region it occupies in the plan and
     *  argument buffers (`planLayout.ts`). */
    maxPlanEntries: 1,
    planRegion: planRegion(1),
    /** What the GPU verdict reads, apart from a view's own frustum, moved this many times (`../expand/expansionFrame.ts`): each view's
     *  counts come back under its own epoch, which follows this one and the view's planes. */
    verdictEpoch: 0,
    /** The expansion's views and the draws' (`../expand/expansionViews.ts`). */
    ...viewState(),
  }
}

/** What the plan draws, built with it, and the items' group. */
export function planTotals() {
  return {
    /** A blend of the plan filters the display value (`filtersDisplay`), built with the plan. */
    filtersDisplay: false,
    /** The blending modes the plan draws, built with it: what a later change must compile for. */
    planModes: [] as Blending[],
    /** The blend variants — a mode in a lighting program — the plan draws (`variantOf`), built with it: what a later change must compile for. */
    planVariants: [] as number[],
    /** A transmissive item of the plan refracts (`refracts`): the distortion is drawn
     *  (`../distortion.ts`), built with the plan. */
    refracts: false,
    /** A transmissive item of the plan may transmit some channels more than others (`chromaRank`): the
     *  dual blend and the modulation pass draw, built with the plan. */
    chromatic: false,
    /** An item of the plan is single-layer water (`WATER_BASE`): the water pass is drawn
     *  (`water/waterPass.ts`), built with the plan. */
    water: false,
  }
}
