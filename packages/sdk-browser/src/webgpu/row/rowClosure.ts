import { createRecordTexture, type RecordTexture } from '../../gpu/core/recordTexture.ts'
import { STRUCTURE_TABLE, type StructureTable } from '../../gpu/dag/structureTable.ts'
import { DAG_ARGS } from '../../gpu/dag/shader/armWgsl.ts'
import { WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { computeBufferEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'
import {
  preparedComputePipeline,
  preparedPipelines,
  started,
} from '../../lighting/deferred/fullscreen.ts'
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts'
import { ROW_CLOSURE_BINDING, ROW_CLOSURE_STAGES } from './rowClosureWgsl.ts'

/** Words of workgroup memory every device holds (`maxComputeWorkgroupStorageSize`, 16 KiB): the
 *  stacks of a workgroup's lanes. */
const STACK_WORDS = 4096

/** The lanes and the stack, a power of two at least `bound`, a closure pipeline is compiled for: as
 *  many lanes as the workgroup's memory holds stacks, `WORKGROUP_THREADS` at most; `undefined` past
 *  what one lane's stack may hold. */
function closureShape(bound: number) {
  const stack = 2 ** Math.ceil(Math.log2(Math.max(1, bound)))
  if (stack > STACK_WORDS) return undefined
  const lanes = Math.min(WORKGROUP_THREADS, STACK_WORDS / stack)
  return { stack, lanes, words: lanes * stack }
}

/** What the closure binds of the row cache this frame: the page→row map and the use words. */
type ClosureRows = { map: GPUBuffer; use: GPUBuffer }
/** Who holds the structures' texture: the cut, whose dispose destroys its textures. */
type TextureOwner = { textures: { texture: GPUTexture; bytes: number }[] }

/**
 * THE ROWS' CLOSURE ON THE CUT'S PASS (`rowClosureWgsl.ts`): its two kernels on the cut's group and
 * a group of its own — the map, the use words, the group structures — dispatched on the arguments
 * the cut armed for its candidates and its live list (`../../gpu/dag/shader/armWgsl.ts`). The
 * structures are sent as the packing places them (`flush`), the table grown in place. Pipelines are
 * compiled off the frame for the structures' stack bound (`closureShape`), from the cut's own
 * module: until the one a bound asks is ready, the closure does not run, and says so — the rows'
 * queue is then not to be trusted (`rowEviction.ts`).
 */
export function createRowClosure(
  device: GPUDevice,
  dag: { layout: GPUBindGroupLayout; module: GPUShaderModule },
) {
  const B = ROW_CLOSURE_BINDING
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(B.rowMap, 'read-only-storage'),
      computeBufferEntry(B.rowUse, 'storage'),
      computeTextureEntry(B.structures, 'uint', '2d-array'),
    ],
  })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [dag.layout, layout] })
  const pipelines = preparedPipelines((stack: number) => {
    const shape = closureShape(stack)!
    const constants = {
      ROW_LANES: shape.lanes,
      ROW_STACK: shape.stack,
      ROW_STACK_WORDS: shape.words,
    }
    return ROW_CLOSURE_STAGES.map((entryPoint) =>
      started(
        preparedComputePipeline(device, {
          label: `Trillion3D row closure ${entryPoint}`,
          layout: pipelineLayout,
          compute: { module: dag.module, entryPoint, constants },
        }),
      ),
    )
  })
  let structures: RecordTexture | undefined,
    sent = 0,
    group: GPUBindGroup | undefined
  const bound = createWebgpuBindIdentity()
  /** The structures placed since the last frame, sent; the table grown first when they pass it,
   *  its texture held among `owner`'s, which its dispose destroys. */
  const flush = (table: StructureTable, owner: TextureOwner) => {
    const old = structures?.texture
    structures ??= createRecordTexture(
      device,
      STRUCTURE_TABLE,
      Math.max(1, table.words),
      GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    )
    if (sent < table.count && !structures.hold(table.words)) return false
    if (structures.texture !== old) {
      const at = owner.textures.findIndex((held) => held.texture === old)
      if (at >= 0) owner.textures.splice(at, 1)
      owner.textures.push({ texture: structures.texture, bytes: structures.bytes })
    }
    const target = structures.target('Word')
    table.flush(sent, (base, data) =>
      target(base * 4, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength),
    )
    sent = table.count
    return true
  }
  return {
    /**
     * The closure of this cut's seeds on `pass`, the cut's group set, its arguments `args`: true
     * when it ran, false while its pipelines compile or its structures could not be held.
     */
    encode(
      pass: GPUComputePassEncoder,
      args: GPUBuffer,
      rows: ClosureRows,
      table: StructureTable,
      owner: TextureOwner,
    ) {
      const shape = closureShape(table.stackBound)
      if (!shape || !flush(table, owner)) return false
      const stages = pipelines.of(shape.stack)
      if (!stages.every((stage) => stage.ready)) return false
      bound.next[0] = rows.map
      bound.next[1] = rows.use
      bound.next[2] = structures!.view
      if (bound.moved() || !group)
        group = device.createBindGroup({
          layout,
          entries: [
            { binding: B.rowMap, resource: { buffer: rows.map } },
            { binding: B.rowUse, resource: { buffer: rows.use } },
            { binding: B.structures, resource: structures!.view },
          ],
        })
      pass.setBindGroup(1, group)
      pass.setPipeline(stages[0].get())
      pass.dispatchWorkgroupsIndirect(args, DAG_ARGS.cand)
      pass.setPipeline(stages[1].get())
      pass.dispatchWorkgroupsIndirect(args, DAG_ARGS.live)
      return true
    },
  }
}
