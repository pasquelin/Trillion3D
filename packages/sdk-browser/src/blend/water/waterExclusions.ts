import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import {
  waterExclusionVolumesOf,
  type WaterExclusionVolume,
} from '../../../../sdk-core/src/world/object/waterExclusionVolume.ts'
import { writeChanged } from '../../gpu/core/writeChanged.ts'
import { sizedBuffer } from '../../gpu/core/sizedBuffer.ts'
import { blendNodeOf } from '../../placement/hidden.ts'
import {
  WATER_EXCLUSION_BINDING,
  WaterExclusionTable,
  waterTableLayout,
} from './waterExclusionTable.ts'
import { waterGroup, waterTargetsOf, type WaterTargets } from './waterTargets.ts'

/** What an image holds of the exclusion volumes: the volumes of the worlds its water bodies belong to, and the ranks of the water items
 *  each node carries (`blendState.waterRanks`). */
interface Gathered {
  /** The frame the volumes were gathered at, and the plan the ranks were taken from. */
  frame: number
  seeds: object | undefined
  readonly volumes: Set<WaterExclusionVolume>
  readonly ranks: Map<Object3D, number[]>
}

const gathered = new WeakMap<WebgpuPagesRuntime, Gathered>()
const none: readonly number[] = []

/**
 * The exclusion volumes of the worlds the image's water belongs to, gathered once an image: the volumes again, the ranks of the water
 * items each node carries only when the plan was rebuilt (`blendState.seeds` is then a new array). Whether the water programs are the
 * variant that cuts the surface inside a volume (`waterWgsl`, `exclusion`) is whether the set is not empty.
 */
export function waterExclusionVolumes(rt: WebgpuPagesRuntime) {
  const { blendState, run } = rt
  let held = gathered.get(rt)
  if (!held)
    gathered.set(rt, (held = { frame: -1, seeds: undefined, volumes: new Set(), ranks: new Map() }))
  if (held.frame === run.frame && held.seeds === blendState.seeds) return held
  held.frame = run.frame
  const { volumes, ranks } = held
  const replanned = held.seeds !== blendState.seeds
  if (replanned) {
    held.seeds = blendState.seeds
    ranks.clear()
  }
  volumes.clear()
  const { waterItems, waterRanks } = blendState
  for (let k = 0; k < waterItems.length; k++) {
    const node = blendNodeOf(waterItems[k])
    if (!node) continue
    for (const volume of waterExclusionVolumesOf(node) ?? []) volumes.add(volume)
    if (!replanned) continue
    const list = ranks.get(node)
    if (list) list.push(waterRanks[k])
    else ranks.set(node, [waterRanks[k]])
  }
  return held
}

const tables = new WeakMap<WaterTargets, WaterExclusionTable>()

/**
 * The groups of the water for the variant with exclusion volumes: the table is packed from the volumes of the image's worlds, written
 * to its buffer when it was repacked (the words that differ only: `writeChanged`), and the groups name it. The shading group is also the
 * depth pass's.
 */
export function waterExclusionsOf(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  targets: WaterTargets,
) {
  const { volumes, ranks, seeds } = waterExclusionVolumes(rt)
  let table = tables.get(targets)
  if (!table) tables.set(targets, (table = new WaterExclusionTable()))
  const repacked = table.pack(volumes, (body) => ranks.get(body) ?? none, seeds!)
  const buffer = sizedBuffer(
    device,
    targets.exclusion?.buffer,
    table.length * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    'Trillion3D water exclusion volumes',
  )
  // A buffer made anew (the table outgrew it) is named by groups made anew, and holds nothing yet.
  const grown = buffer !== targets.exclusion?.buffer
  if (grown) targets.exclusion = { buffer, shade: waterGroup(device, targets, false, buffer) }
  if (repacked || grown) writeChanged(device, buffer, table.words, 0, table.length)
  const exclusion = targets.exclusion!
  return {
    table: (exclusion.table ??= device.createBindGroup({
      label: 'Trillion3D water exclusion volumes',
      layout: waterTableLayout(device),
      entries: [{ binding: WATER_EXCLUSION_BINDING, resource: { buffer } }],
    })),
    shade: exclusion.shade,
    composite: (exclusion.composite ??= waterGroup(device, targets, true, exclusion.buffer)),
  }
}

/** The group of the table alone, for a pass before the water that cuts its surface (`waterTableLayout`): the table packed and written as
 *  the water's own is. */
export const waterTableGroup = (rt: WebgpuPagesRuntime, device: GPUDevice) =>
  waterExclusionsOf(rt, device, waterTargetsOf(rt, device)).table

/** The count of the times the water's exclusion table was rewritten (`WaterExclusionTable.revision`), the table packed as the water's own is: a pass that draws what the volumes cut keeps it to draw again when they moved. */
export function waterExclusionRevision(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const targets = waterTargetsOf(rt, device)
  waterExclusionsOf(rt, device, targets)
  return tables.get(targets)!.revision
}
