import { CORNER_VALUES } from '../partition/contract.ts'
import { buildComputePipeline } from '../../lighting/deferred/fullscreen.ts'
import { transparentOcclusionShader } from './transparentOcclusionWgsl.ts'
import { shaderFailed } from './shaderModule.ts'
import { retire } from './frameRetire.ts'
import { computeBufferEntry, computeTextureEntry, sequentialEntries } from './computeBindings.ts'
import { bitWords, workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../dispatch/grid.ts'
import { TRANSPARENT_OCCLUSION_PASS } from '../../stage/passLabels.ts'
import {
  createWebgpuBindIdentity,
  type WebgpuBindIdentity,
} from '../../webgpu/core/bindIdentity.ts'

export type TransparentOcclusion = NonNullable<
  Awaited<ReturnType<typeof createTransparentOcclusion>>
>

/** What the test borrows from the rest of the frame: the Hi-Z pyramid it just built and its
 *  levels uniform, the uniform the partition wrote for it, and the compact's verdict buffer. */
type TransparentOcclusionSources = {
  pyramid: () => GPUTextureView | undefined
  levels: GPUBuffer
  uniforms: GPUBuffer
  /** The verdict buffer the compact owns, read at each image: it follows the compact's growth. */
  occluded: () => GPUBuffer
}

/**
 * Occlusion of transparent clusters, done by the GPU, on the current frame's pyramid.
 *
 * It owns two buffers: the world corners of each transparent-table entry, as two
 * single-precision values, derived on the GPU only when a world matrix changes, and one bit per entry that
 * is never culled (`neverCulled`), which it never rejects. Everything else is
 * borrowed — pyramid, uniform, verdict buffer — so the rule applied to transparent clusters is
 * that of the opaques to the bit, and no frame pays two projections.
 */
export async function createTransparentOcclusion(
  device: GPUDevice,
  entryCount: number,
  sources: TransparentOcclusionSources,
) {
  if (entryCount < 1) return undefined
  const buffers = occlusionBuffers(device, entryCount)
  let o: Occlusion
  try {
    const made = await occlusionPipeline(device)
    if (!made) return freed(buffers)
    o = {
      ...{ device, entryCount, sources, ...buffers, ...made },
      ...{ bound: createWebgpuBindIdentity(), bindGroup: undefined, disposed: false },
      // A thread an entry.
      groups: workgroupCount(entryCount, WORKGROUP_THREADS),
    }
    return {
      /** The world corners of each entry, the entries pass's (`../../webgpu/transparent/
       *  entryCorners.ts`): made anew by a growth. */
      get corners() {
        return o.corners
      },
      /** One bit per entry, set where the entry is never culled: filled by the owner, then sent
       *  whole by `uploadUnculled`. */
      get unculledBits() {
        return o.unculledBits
      },
      uploadUnculled() {
        if (!o.disposed) device.queue.writeBuffer(o.unculled, 0, o.unculledBits)
      },
      /** The entries the test covers: past them it reads nothing. */
      get entryCount() {
        return o.entryCount
      },
      /** The test made to cover `entries`, its buffers made over when it covers fewer: the pipeline
       *  names no size. Returns whether they were — the corners and bits are then to be sent again. */
      grow(entries: number) {
        if (o.disposed || entries <= o.entryCount) return false
        // The old buffers may be named by this image's commands: retired, never destroyed now.
        retire(device, o.corners)
        retire(device, o.unculled)
        Object.assign(o, occlusionBuffers(device, entries), { entryCount: entries })
        o.groups = workgroupCount(entries, WORKGROUP_THREADS)
        return true
      },
      /**
       * Writes each entry's verdict for this frame. Without a fresh pyramid there is nothing to
       * walk: the buffer goes back to zero, and the compact keeps all its entries.
       */
      encode: (encoder: GPUCommandEncoder, pyramidFresh: boolean) =>
        encodeOcclusion(o, encoder, pyramidFresh),
      dispose() {
        o.disposed = true
        freed(o)
      },
    }
  } catch {
    // A partial GPU setup must leak nothing.
    return freed(buffers)
  }
}

type Occlusion = NonNullable<Awaited<ReturnType<typeof occlusionPipeline>>> & {
  device: GPUDevice
  entryCount: number
  sources: TransparentOcclusionSources
  corners: GPUBuffer
  unculledBits: Uint32Array<ArrayBuffer>
  unculled: GPUBuffer
  /** What the bind group names (`createWebgpuBindIdentity`): the pyramid, which changes identity on
   *  every target resize, the verdicts and the buffers a growth makes over; a frame without a
   *  pyramid encodes nothing rather than reading a dead buffer. */
  bound: WebgpuBindIdentity
  bindGroup: GPUBindGroup | undefined
  disposed: boolean
  groups: number
}

/** The test's own buffers freed at once: none was ever named by a submitted command. */
function freed(buffers: { corners: GPUBuffer; unculled: GPUBuffer }) {
  buffers.corners.destroy()
  buffers.unculled.destroy()
  return undefined
}

/** The world corners of each entry, and one bit per entry never culled. */
function occlusionBuffers(device: GPUDevice, entryCount: number) {
  const corners = device.createBuffer({
    label: 'Trillion3D transparent occlusion corners v1',
    size: entryCount * CORNER_VALUES * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const unculledBits = new Uint32Array(bitWords(entryCount)),
    unculled = device.createBuffer({
      label: 'Trillion3D transparent occlusion never culled v1',
      size: unculledBits.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
  return { corners, unculledBits, unculled }
}

/** The test's layout and pipeline; undefined when its module fails. */
async function occlusionPipeline(device: GPUDevice) {
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(0, 'read-only-storage'),
      computeTextureEntry(1, 'uint', '2d-array'),
      computeBufferEntry(2, 'storage'),
      computeBufferEntry(3, 'uniform'),
      computeBufferEntry(4, 'read-only-storage'),
      computeBufferEntry(5, 'uniform'),
    ],
  })
  const module = device.createShaderModule({ code: transparentOcclusionShader() })
  if (await shaderFailed(module)) return undefined
  const pipeline = await buildComputePipeline(device, {
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'testTransparentClusters' },
  })
  return { layout, pipeline }
}

function encodeOcclusion(o: Occlusion, encoder: GPUCommandEncoder, pyramidFresh: boolean) {
  if (o.disposed) return
  const { sources } = o
  const pyramid = pyramidFresh ? sources.pyramid() : undefined
  if (!pyramid) {
    encoder.clearBuffer(sources.occluded(), 0, o.entryCount * 4)
    return
  }
  const occluded = sources.occluded()
  const { next } = o.bound
  next[0] = pyramid
  next[1] = occluded
  next[2] = o.corners
  next[3] = o.unculled
  next[4] = sources.uniforms
  next[5] = sources.levels
  if (o.bound.moved())
    o.bindGroup = o.device.createBindGroup({
      layout: o.layout,
      entries: sequentialEntries([
        { buffer: o.corners },
        pyramid,
        { buffer: occluded },
        { buffer: sources.uniforms },
        { buffer: o.unculled },
        { buffer: sources.levels },
      ]),
    })
  const pass = encoder.beginComputePass({ label: TRANSPARENT_OCCLUSION_PASS })
  pass.setPipeline(o.pipeline)
  pass.setBindGroup(0, o.bindGroup!)
  dispatchRows(pass, o.groups)
  pass.end()
}
