/**
 * THE BINS PASS ENCODED (`rowBinsWgsl.ts`): once a frame a bound's bins pay, what they are asked
 * with moved since the last one submitted (`bins.asked`) and a staging buffer is free, after the
 * rows pass wrote the spheres, the histograms cleared, every row of the range binned, and the
 * histograms copied into a buffer of the readback ring (`../gpu/core/readbackRing.ts`). It maps
 * after the frame's submit (`rowBinsSubmitted`), its ask then the one later asks are compared with,
 * and lands a few frames later (`landRowBins`): no frame waits for it, and a frame with every
 * buffer in flight bins nothing. Its kernel compiles off the thread: the bound keeps the worst case
 * until it has.
 */
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { createReadbackRing } from '../gpu/core/readbackRing.ts'
import { autoKernel } from '../gpu/core/computeStages.ts'
import { sizedBuffer } from '../gpu/core/sizedBuffer.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../gpu/dispatch/grid.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { composeGroup, heldGroup } from '../placement/composeGroups.ts'
import { rowBinTables } from './rowBins.ts'
import { rowBinsRequest } from './rowBinsParams.ts'
import { landRowBins, type RowBinsScene, type RowBinsTag } from './rowBinsRecord.ts'
import { ROW_BINS_WGSL } from './rowBinsWgsl.ts'
import type { VsmBoundLight, VsmRowBound } from './rowPageBound.ts'

const LABEL = 'Trillion3D shadow row bins'
/** Histograms in flight at most: one a frame, each read a few frames late. */
const IN_FLIGHT = 3

/** The kernel, once a device, compiled off the thread. */
const kernel = autoKernel(LABEL, ROW_BINS_WGSL, 'main')

/** The joint bins' tables (`rowBinTables`) on `device`. */
function createTables(device: GPUDevice) {
  const words = rowBinTables()
  const buffer = device.createBuffer({
    label: `${LABEL} tables`,
    size: words.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(buffer, 0, words)
  return buffer
}

/** A bound's pass on one device: its tables, its parameters, its histograms, its group over the
 *  buffers `bound` names — the spheres, the mobility words, the parameters, the tables, the
 *  histograms — and its ring, all released with it (`releaseRowBins`). */
function createRowBinsGpu(device: GPUDevice, bound: VsmRowBound) {
  const tables = createTables(device),
    held = heldGroup()
  const named: GPUBufferBinding[] = Array.from({ length: 5 }, () => ({ buffer: tables }))
  held.identity.entries[0] = sequentialEntries(named)
  return {
    device,
    tables,
    params: undefined as GPUBuffer | undefined,
    bins: undefined as GPUBuffer | undefined,
    held,
    named,
    /** The ask whose histogram this frame's encoder copies, until its submit makes it the last
     *  asked (`rowBinsSubmitted`). */
    taken: undefined as RowBinsTag | undefined,
    ring: createReadbackRing<RowBinsTag>(
      device,
      { label: LABEL, bytes: 4, count: IN_FLIGHT },
      (mapped, _, tag) => landRowBins(bound.bins, tag, mapped),
    ),
  }
}
type RowBinsGpu = ReturnType<typeof createRowBinsGpu>
const gpus = new WeakMap<VsmRowBound, RowBinsGpu>()

/** Frees what the pass of `bound` holds on its device, if it holds any: at the teardown of the
 *  shadows that own it (`destroyEngineVsm`), or for a pass made again on another device. */
export function releaseRowBins(bound: VsmRowBound | undefined) {
  const held = bound && gpus.get(bound)
  if (!held) return
  held.ring.destroy()
  held.tables.destroy()
  held.params?.destroy()
  held.bins?.destroy()
  gpus.delete(bound)
  bound.bins.asked = undefined
}

/** The pass of `bound` on `device`: the one it holds, or made again for another device. */
function gpuOf(device: GPUDevice, bound: VsmRowBound) {
  const held = gpus.get(bound)
  if (held?.device === device) return held
  releaseRowBins(bound)
  const made = createRowBinsGpu(device, bound)
  gpus.set(bound, made)
  return made
}

/** The bins pass of `bound` over rows `[first, end)` of `scene` under `lights`, into `encoder`:
 *  nothing when the bins would bound nothing, would bin what the last one submitted did over the
 *  same buffers (`bins.asked`), the kernel is compiling, or every staging buffer is in flight. */
export function encodeRowBins(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  bound: VsmRowBound,
  scene: RowBinsScene,
  range: { first: number; end: number },
  lights: readonly VsmBoundLight[],
) {
  // An ask taken by an encoder never submitted: its buffer free again, read never.
  const last = gpus.get(bound)
  if (last?.taken) {
    last.ring.dropped()
    last.taken = undefined
  }
  const request = rowBinsRequest(bound.bins, scene, range, lights)
  if (!request) return
  const compiled = kernel(device)
  if (!compiled.ready) return void compiled.prepare().catch(() => {})
  const gpu = gpuOf(device, bound),
    { tag, params } = request,
    bytes = tag.words * 4
  const staging = gpu.ring.take(tag, bytes)
  if (!staging) return
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  gpu.params = sizedBuffer(device, gpu.params, params.byteLength, storage, LABEL)
  device.queue.writeBuffer(gpu.params, 0, params)
  gpu.bins = sizedBuffer(device, gpu.bins, bytes, storage | GPUBufferUsage.COPY_SRC, LABEL)
  const named = gpu.named
  named[0].buffer = scene.spheres
  named[1].buffer = scene.mobility
  named[2].buffer = gpu.params
  named[4].buffer = gpu.bins
  const pipeline = compiled.get()
  composeGroup(device, gpu.held, pipeline)
  encoder.clearBuffer(gpu.bins, 0, bytes)
  const pass = encoder.beginComputePass({ label: LABEL })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, gpu.held.group!)
  dispatchRows(pass, ceilDiv(range.end - range.first, WORKGROUP_THREADS))
  pass.end()
  encoder.copyBufferToBuffer(gpu.bins, 0, staging, 0, bytes)
  gpu.taken = tag
}

/** After the frame's submit: the histogram its encoder copied maps, and lands a few frames late;
 *  its ask is the last asked. */
export function rowBinsSubmitted(bound: VsmRowBound | undefined) {
  const gpu = bound && gpus.get(bound)
  if (!bound || !gpu?.taken) return
  gpu.ring.submitted()
  bound.bins.asked = gpu.taken
  gpu.taken = undefined
}
