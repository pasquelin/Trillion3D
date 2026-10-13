/**
 * THE BINS PASS ENCODED (`rowBinsWgsl.ts`): once a frame a bound's bins pay and a staging buffer is
 * free, after the rows pass wrote the spheres, the histograms cleared, every row of the range binned,
 * and the histograms copied into a buffer of the readback ring (`../gpu/core/readbackRing.ts`). It
 * maps after the frame's submit (`rowBinsSubmitted`) and lands a few frames later
 * (`landRowBins`): no frame waits for it, and a frame with every buffer in flight bins nothing. Its
 * kernel compiles off the thread: the bound keeps the worst case until it has.
 */
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { grownLength } from '../../../math/src/sequence/resized.ts'
import { createReadbackRing } from '../gpu/core/readbackRing.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../gpu/dispatch/grid.ts'
import { preparedComputePipeline } from '../lighting/deferred/fullscreen.ts'
import { composeGroup, heldGroup } from '../placement/composeGroups.ts'
import { rowBinTables } from './rowBins.ts'
import { rowBinsRequest } from './rowBinsParams.ts'
import { landRowBins, type RowBinsTag } from './rowBinsRecord.ts'
import { ROW_BINS_WGSL } from './rowBinsWgsl.ts'
import type { VsmBoundLight, VsmRowBound, VsmRowSpheres } from './rowPageBound.ts'

const LABEL = 'Trillion3D shadow row bins'
/** Histograms in flight at most: one a frame, each read a few frames late. */
const IN_FLIGHT = 3

/** The kernel, once a device, compiled off the thread. */
const kernel = oncePerDevice((device) =>
  preparedComputePipeline(device, {
    label: LABEL,
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ label: LABEL, code: ROW_BINS_WGSL }),
      entryPoint: 'main',
    },
  }),
)

/** The joint bins' tables (`rowBinTables`), once a device. */
const tablesOf = oncePerDevice((device) => {
  const words = rowBinTables()
  const buffer = device.createBuffer({
    label: `${LABEL} tables`,
    size: words.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(buffer, 0, words)
  return buffer
})

/** A bound's pass on one device: its parameters, its histograms, its group and its ring. */
function createRowBinsGpu(device: GPUDevice, bound: VsmRowBound) {
  return {
    device,
    params: undefined as GPUBuffer | undefined,
    bins: undefined as GPUBuffer | undefined,
    held: heldGroup(),
    ring: createReadbackRing<RowBinsTag>(
      device,
      { label: LABEL, bytes: 4, count: IN_FLIGHT },
      (mapped, _, tag) => landRowBins(bound.bins, tag, mapped),
    ),
  }
}
type RowBinsGpu = ReturnType<typeof createRowBinsGpu>
const gpus = new WeakMap<VsmRowBound, RowBinsGpu>()

/** The pass of `bound` on `device`: the one it holds, or made again for another device. */
function gpuOf(device: GPUDevice, bound: VsmRowBound) {
  const held = gpus.get(bound)
  if (held?.device === device) return held
  if (held) {
    held.ring.destroy()
    held.params?.destroy()
    held.bins?.destroy()
  }
  const made = createRowBinsGpu(device, bound)
  gpus.set(bound, made)
  return made
}

/** `held` when it holds `bytes`, else a buffer of `usage` grown by the one rule. */
function sized(device: GPUDevice, held: GPUBuffer | undefined, bytes: number, usage: number) {
  if (held && held.size >= bytes) return held
  held?.destroy()
  return device.createBuffer({
    label: LABEL,
    size: grownLength(held ? held.size : 0, bytes),
    usage: usage | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
}

/** What the pass reads of the frame: the rows' spheres and mobility words, and what changed in
 *  the spheres (`VsmRowSpheres`). */
interface RowBinsScene {
  spheres: GPUBuffer
  mobility: GPUBuffer
  rowSpheres: VsmRowSpheres
}

/** The bins pass of `bound` over rows `[first, end)` of `scene` under `lights`, into `encoder`:
 *  nothing when the bins would bound nothing, the kernel is compiling, or every staging buffer is
 *  in flight. */
export function encodeRowBins(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  bound: VsmRowBound,
  scene: RowBinsScene,
  range: { first: number; end: number },
  lights: readonly VsmBoundLight[],
) {
  const request = rowBinsRequest(bound.bins, scene.rowSpheres, range, lights)
  if (!request) return
  const compiled = kernel(device)
  if (!compiled.ready) return void compiled.prepare().catch(() => {})
  const gpu = gpuOf(device, bound),
    { tag, params } = request,
    bytes = tag.words * 4
  const staging = gpu.ring.take(tag, bytes)
  if (!staging) return
  gpu.params = sized(device, gpu.params, params.byteLength, 0)
  device.queue.writeBuffer(gpu.params, 0, params)
  gpu.bins = sized(device, gpu.bins, bytes, GPUBufferUsage.COPY_SRC)
  const resources = [scene.spheres, scene.mobility, gpu.params, tablesOf(device), gpu.bins]
  const entries = (gpu.held.identity.entries[0] ??= resources.map((buffer, binding) => ({
    binding,
    resource: { buffer },
  })))
  resources.forEach(
    (buffer, binding) => ((entries[binding].resource as GPUBufferBinding).buffer = buffer),
  )
  const pipeline = compiled.get()
  composeGroup(device, gpu.held, pipeline)
  encoder.clearBuffer(gpu.bins, 0, bytes)
  const pass = encoder.beginComputePass({ label: LABEL })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, gpu.held.group!)
  dispatchRows(pass, ceilDiv(range.end - range.first, WORKGROUP_THREADS))
  pass.end()
  encoder.copyBufferToBuffer(gpu.bins, 0, staging, 0, bytes)
}

/** After the frame's submit: the histogram its encoder copied maps, and lands a few frames late. */
export function rowBinsSubmitted(bound: VsmRowBound | undefined) {
  if (bound) gpus.get(bound)?.ring.submitted()
}
