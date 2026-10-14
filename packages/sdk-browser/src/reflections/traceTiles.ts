import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { TRACE_LIST, TRACE_LIST_FIRST } from '../bounce/runtimeLayout.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { BEGIN_BINDINGS } from './traceBindings.ts'

/**
 * The frame's reflection state, one thread: the tile list emptied, its indirect arguments set
 * (`TRACE_SHADER`); the run-time proxy's frame counters started again and its schedule moved on —
 * the budget ran out at the cursor, so the next frame starts there (the list's offset); when every
 * pixel holds its answer, where it is.
 * The radiance around the scene (`surroundings`) is the CPU's, written with the view
 * (`createSurroundings`, `../lighting/toneUnmap.ts`).
 */
export const BEGIN_SHADER = wgslProgram(
  `@group(0) @binding(${BEGIN_BINDINGS.work}) var<storage,read_write> work:array<u32>;
@group(0) @binding(${BEGIN_BINDINGS.list}) var<storage,read_write> traceList:array<u32>;
@compute @workgroup_size(1)
fn reflectionBegin(){
 work[0]=0u;work[1]=1u;work[2]=1u;work[3]=0u;
 traceList[${TRACE_LIST.count}u]=0u;
 if(traceList[${TRACE_LIST.left}u]!=0u){traceList[${TRACE_LIST.offset}u]+=traceList[${TRACE_LIST.cursor}u];}
 traceList[${TRACE_LIST.cursor}u]=0u;
 traceList[${TRACE_LIST.left}u]=0u;traceList[${TRACE_LIST.spent}u]=0u;
}`,
  [],
)

/** Bytes of the indirect arguments: the workgroups along x and y, 1, then the count of tiles. */
export const TRACE_ARGS_BYTES = 16

/** Bytes of the list of a view at `width × height`: its counters, then a tile a word. */
export const traceListBytes = (width: number, height: number) =>
  TRACE_LIST_FIRST * 4 + ceilDiv(width, REFLECTION_SIDE) * ceilDiv(height, REFLECTION_SIDE) * 4

/** The tiles of a view: the indirect arguments (`TRACE_ARGS_BYTES`), and the list the classification
 *  writes and the trace reads, with the frame's counters (`TRACE_LIST`). */
export const createTraceTiles = (device: GPUDevice, width: number, height: number) => ({
  args: device.createBuffer({
    label: 'Trillion3D reflection tile count',
    size: TRACE_ARGS_BYTES,
    // Its count is copied to the settle sample (`settle.ts`).
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC,
  }),
  // Apart from the indirect arguments: the trace dispatches on those, and a dispatch cannot bind its
  // own indirect buffer writable, as the trace binds the list (its words are atomic). Its counters
  // are copied to the settle sample (`settle.ts`).
  list: device.createBuffer({
    label: 'Trillion3D reflection tile list',
    size: traceListBytes(width, height),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  }),
})
export type TraceTiles = ReturnType<typeof createTraceTiles>
