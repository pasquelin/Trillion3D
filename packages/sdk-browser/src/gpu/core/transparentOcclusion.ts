import { CORNER_VALUES, PARTITION_WORKGROUP } from '../partition/contract.ts'
import { buildComputePipeline } from '../../lighting/deferred/fullscreen.ts'
import { transparentOcclusionShader } from './transparentOcclusionWgsl.ts'
import { shaderFailed } from './shaderModule.ts'
import { bounceGroup, bounceLayout } from '../../bounce/bindings.ts'
import { bitWords, workgroupCount } from '../../../../math/src/scalar/integers.ts'

export type TransparentOcclusion = NonNullable<
  Awaited<ReturnType<typeof createTransparentOcclusion>>
>

/** What the test borrows from the rest of the frame: the Hi-Z pyramid it just built,
 *  the uniform the partition wrote for it, and the compact's verdict buffer. */
export type TransparentOcclusionSources = {
  pyramid: () => GPUBuffer | undefined
  uniforms: GPUBuffer
  occluded: GPUBuffer
}

/**
 * Occlusion of transparent clusters, done by the GPU, on the current frame's pyramid.
 *
 * It owns two buffers: the world corners of each transparent-table entry, as two
 * single-precision values, rewritten only when a world matrix changes, and one bit per entry that
 * is never culled (`neverCulled`), which it never rejects. Everything else is
 * borrowed — pyramid, uniform, verdict buffer — so the rule applied to transparent clusters is
 * that of the opaques to the bit, and no frame pays two projections.
 */
export async function createTransparentOcclusion(
  device: GPUDevice,
  entryCount: number,
  sources: TransparentOcclusionSources,
) {
  if (typeof device.createComputePipeline !== 'function' || entryCount < 1) return undefined
  const { corners, unculledBits, unculled } = occlusionBuffers(device, entryCount)
  const destroy = () => {
    corners.destroy()
    unculled.destroy()
  }
  try {
    const made = await occlusionPipeline(device, entryCount)
    if (!made) {
      destroy()
      return undefined
    }
    const o: Occlusion = {
      ...{ device, entryCount, sources, corners, unculled, ...made },
      ...{ bound: undefined, bindGroup: undefined, disposed: false },
      groups: workgroupCount(entryCount, PARTITION_WORKGROUP),
    }
    return {
      /** World corners of entries `[from, to]`, on the only interval the table changed. */
      uploadCorners: (packed: Float32Array, from: number, to: number) =>
        uploadCorners(o, packed, from, to),
      /** One bit per entry, set where the entry is never culled: filled by the owner, then sent
       *  whole by `uploadUnculled`. */
      unculledBits,
      uploadUnculled() {
        if (!o.disposed) device.queue.writeBuffer(unculled, 0, unculledBits)
      },
      /**
       * Writes each entry's verdict for this frame. Without a fresh pyramid there is nothing to
       * walk: the buffer goes back to zero, and the compact keeps all its entries.
       */
      encode: (encoder: GPUCommandEncoder, pyramidFresh: boolean) =>
        encodeOcclusion(o, encoder, pyramidFresh),
      dispose() {
        o.disposed = true
        destroy()
      },
    }
  } catch {
    try {
      destroy()
    } catch {
      /* A partial GPU setup must leak nothing. */
    }
    return undefined
  }
}

type Occlusion = NonNullable<Awaited<ReturnType<typeof occlusionPipeline>>> & {
  device: GPUDevice
  entryCount: number
  sources: TransparentOcclusionSources
  corners: GPUBuffer
  unculled: GPUBuffer
  /** The pyramid changes identity on every target resize: the bind group follows it, and a
   *  frame without a pyramid encodes nothing rather than reading a dead buffer. */
  bound: GPUBuffer | undefined
  bindGroup: GPUBindGroup | undefined
  disposed: boolean
  groups: number
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
async function occlusionPipeline(device: GPUDevice, entryCount: number) {
  const layout = bounceLayout(device, [
    'read-only-storage',
    'read-only-storage',
    'storage',
    'uniform',
    'read-only-storage',
  ])
  const module = device.createShaderModule({ code: transparentOcclusionShader(entryCount) })
  if (await shaderFailed(module)) return undefined
  const pipeline = await buildComputePipeline(device, {
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'testTransparentClusters' },
  })
  return { layout, pipeline }
}

const CORNER_BYTES = CORNER_VALUES * 4

function uploadCorners(o: Occlusion, packed: Float32Array, from: number, to: number) {
  if (o.disposed || to < from) return
  o.device.queue.writeBuffer(
    o.corners,
    from * CORNER_BYTES,
    packed.buffer as ArrayBuffer,
    packed.byteOffset + from * CORNER_BYTES,
    (to - from + 1) * CORNER_BYTES,
  )
}

function encodeOcclusion(o: Occlusion, encoder: GPUCommandEncoder, pyramidFresh: boolean) {
  if (o.disposed) return
  const { sources } = o
  const pyramid = pyramidFresh ? sources.pyramid() : undefined
  if (!pyramid) {
    encoder.clearBuffer(sources.occluded, 0, o.entryCount * 4)
    return
  }
  if (pyramid !== o.bound || !o.bindGroup) {
    o.bound = pyramid
    o.bindGroup = bounceGroup(o.device, o.layout, [
      o.corners,
      pyramid,
      sources.occluded,
      sources.uniforms,
      o.unculled,
    ])
  }
  const pass = encoder.beginComputePass({ label: 'Trillion3D transparent occlusion' })
  pass.setPipeline(o.pipeline)
  pass.setBindGroup(0, o.bindGroup)
  pass.dispatchWorkgroups(o.groups)
  pass.end()
}
