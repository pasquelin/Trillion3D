import { dispatchOn } from '../../../gpu/core/computeStages.ts'
import { ComputeRun } from '../../../gpu/core/lazyComputePass.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { encodeTileScatter, tileScatterTargets } from '../tileScatter.ts'
import type { DfshGroups } from './groups.ts'
import { DFSH_CULL_GROUP, DFSH_OFFSET_GROUP, DFSH_PARAMS_STRIDE } from './layout.ts'
import type { DfshSettings } from './params.ts'
import type { DfshPrograms } from './pipelines.ts'
import type { DfshView } from './view.ts'

const LABEL = 'Trillion3D sun distance-field shadow'
const CULL_PASS: GPUComputePassDescriptor = { label: `${LABEL} cull` }
const OFFSETS_PASS: GPUComputePassDescriptor = { label: `${LABEL} offsets` }
const SCATTER = tileScatterTargets(LABEL)
/** The image's compute passes that follow one another, one pass but on a frame timed per pass. */
const steps = new ComputeRun()

/** What the host holds of the suns' mesh lists between images: its resources. */
export interface DfshState {
  view: DfshView | undefined
  /** Why the lists were not made, where the budget refused them. */
  why: string | undefined
}

/** A state with nothing drawn. */
export const createDfshState = (): DfshState => ({ view: undefined, why: undefined })

/** One sun's lists: the tiles along a side of its grid, its place among the suns, the meshes of the scene and the settings of the lists. */
interface SunList {
  side: number
  index: number
  objects: number
  settings: Pick<DfshSettings, 'compactTiles'>
}

/** The meshes' bounding boxes drawn into the grid of tiles: the count pass or the write pass. */
function scatter(
  encoder: GPUCommandEncoder,
  programs: DfshPrograms,
  view: DfshView,
  groups: Pick<DfshGroups, 'scatter'>,
  draw: { side: number; offset: number; which: 'count' | 'write' },
) {
  const { side, offset, which } = draw
  SCATTER.target.view = view.standIn.view
  encodeTileScatter(
    encoder,
    SCATTER[which],
    which === 'count' ? programs.countTiles : programs.writeTiles,
    groups.scatter,
    side,
    side,
    view.objectArgs,
    undefined,
    offset,
  )
}

/** A sun's meshes listed by the tiles of its shadow space: the meshes culled to it, then — scattered to the grid of tiles — their
 *  tiles counted, given their runs and written (the count and the runs only where the lists are compacted,
 *  `distanceFieldShadowCompactTiles`). The passes go into the run `steps` is in. */
function listMeshes(programs: DfshPrograms, view: DfshView, groups: DfshGroups, list: SunList) {
  const { side, index, objects, settings } = list
  const { compactTiles } = settings
  const offset = index * DFSH_PARAMS_STRIDE
  const tiles = side * side * 4
  const apart = steps.apart()
  apart.clearBuffer(view.objectArgs)
  if (compactTiles) apart.clearBuffer(view.nextOffset)
  apart.clearBuffer(view.tileCounts, 0, tiles)
  const culling = steps.pass(CULL_PASS)
  dispatchOn(
    culling,
    programs.compute.cull,
    groups.cull,
    ceilDiv(objects, DFSH_CULL_GROUP),
    1,
    offset,
  )
  if (compactTiles) {
    scatter(steps.apart(), programs, view, groups, { side, offset, which: 'count' })
    const offsets = steps.pass(OFFSETS_PASS)
    dispatchOn(
      offsets,
      programs.compute.offsets,
      groups.offsets,
      ceilDiv(side, DFSH_OFFSET_GROUP),
      ceilDiv(side, DFSH_OFFSET_GROUP),
      offset,
    )
    steps.apart().clearBuffer(view.tileCounts, 0, tiles)
  }
  scatter(steps.apart(), programs, view, groups, { side, offset, which: 'write' })
}

/** A sun's meshes listed by the tiles of its shadow space, in `encoder` (`listMeshes`): the suns of the surface cache, which are
 *  traced from the cache's own rays. */
export function encodeShadowTiles(
  encoder: GPUCommandEncoder,
  programs: DfshPrograms,
  view: DfshView,
  groups: DfshGroups,
  list: SunList,
) {
  steps.begin(encoder)
  listMeshes(programs, view, groups, list)
  steps.end()
}
