import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import {
  dagReadEntries,
  dagReadLayoutEntries,
  type DagReadTables,
} from '../../../geometry/dag/shader/bindings.ts'
import { startedComputeStages } from '../../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { composeGroup, heldGroup } from '../../../gpu/bind/bindIdentity.ts'
import { bufferEntry } from '../../../gpu/bind/liveEntries.ts'
import { dispatchRows, groupWidth, WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import {
  SCENE_CULL_BINDING,
  SCENE_CULL_ENTRY,
  SCENE_CULL_MODE,
  SCENE_CULL_WGSL,
  sceneCullLayoutEntries,
} from './sceneCullWgsl.ts'

/** The culling pass's label: its kernel and its pass. */
const SCENE_CULL_LABEL = 'Trillion3D scene trace culling'

/** The culling kernel of a device, one whatever the world, compiled off the frame from the first call on (`startedComputeStages`):
 *  its layout is the cut's tables in group 0, the scene trace's parameters and table in group 1. */
const cullKernel = oncePerDevice((device: GPUDevice) =>
  startedComputeStages(
    device,
    SCENE_CULL_LABEL,
    device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({ entries: dagReadLayoutEntries() }),
        device.createBindGroupLayout({ entries: sceneCullLayoutEntries() }),
      ],
    }),
    device.createShaderModule({ label: SCENE_CULL_LABEL, code: SCENE_CULL_WGSL }),
    [SCENE_CULL_ENTRY],
  ),
)

/** What a scene trace's culling binds: its parameters, the table it writes the words in, and the cut's tables. */
export interface SceneCullBound {
  params: GPUBuffer
  table: GPUBuffer
  views: DagReadTables
}

/** The pass's two groups, held over what `bound` names, read live (`liveEntries.ts`): made again only when the
 *  pipeline or a resource moved; and `stale`, the first words of the table that may hold a nonzero word (a table begins at
 *  zero). */
export function createCullGroups() {
  const bound = {} as SceneCullBound
  const tables = heldGroup(),
    own = heldGroup()
  tables.identity.entries[0] = dagReadEntries(() => bound.views)
  own.identity.entries[0] = [
    bufferEntry(SCENE_CULL_BINDING.params, () => bound.params),
    bufferEntry(SCENE_CULL_BINDING.culled, () => bound.table),
  ]
  return { bound, tables, own, stale: 0 }
}

/**
 * Chooses, on `encoder`, the `placements` the image's rays can meet (`sceneCullWgsl.ts`): the words of the scene trace's
 * table at `cullWord` (`stParams.cullWord`) written, nonzero for a placement left out. While the kernel is not compiled nothing
 * is written, and every placement stays in (a table's words begin at zero); the compile starts at the first call. A `mode`
 * that culls nothing (`SCENE_CULL_MODE.disabled`) leaves every word zero: the words an earlier mode wrote (`groups.stale`)
 * are cleared once, whatever the placements now. Returns whether the words were written.
 */
export function encodeSceneCull(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  groups: ReturnType<typeof createCullGroups>,
  bound: SceneCullBound,
  placements: number,
  mode: number,
  cullWord: number,
) {
  if (mode === SCENE_CULL_MODE.disabled) {
    if (groups.stale === 0) return false
    encoder.clearBuffer(bound.table, cullWord * 4, groups.stale * 4)
    groups.stale = 0
    return true
  }
  const kernel = cullKernel(device)
  if (!kernel.ready || placements === 0) return false
  const pipeline = kernel.pipelineOf(SCENE_CULL_ENTRY)
  Object.assign(groups.bound, bound)
  const pass = encoder.beginComputePass({ label: SCENE_CULL_LABEL })
  pass.setPipeline(pipeline)
  composeGroup(device, groups.tables, pipeline)
  pass.setBindGroup(0, groups.tables.group!)
  composeGroup(device, groups.own, pipeline, 1)
  pass.setBindGroup(1, groups.own.group!)
  dispatchRows(pass, ceilDiv(placements, WORKGROUP_THREADS), 1, groupWidth(device.limits))
  pass.end()
  groups.stale = Math.max(groups.stale, placements)
  return true
}
