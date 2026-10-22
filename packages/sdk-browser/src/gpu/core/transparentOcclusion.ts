import { CORNER_VALUES } from './boxProjectWgsl.ts'
import {
  createProjectionUniformWriter,
  PROJECTION_UNI,
  type ProjectionFrame,
} from './projectionUniform.ts'
import { buildComputeStage } from './computeStages.ts'
import {
  TRANSPARENT_REFERENCE_TEST,
  transparentOcclusionShader,
} from './transparentOcclusionWgsl.ts'
import { shaderFailed } from './shaderModule.ts'
import { retire } from './frameRetire.ts'
import { createHeldCopy, type CullStep, type HeldCopy } from './heldCopy.ts'
import { computeBufferEntry, computeTextureEntry, sequentialEntries } from './computeBindings.ts'
import { bitWords, workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../dispatch/grid.ts'
import { TRANSPARENT_OCCLUSION_PASS } from '../../diagnostic/stage/passLabels.ts'
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../bind/bindIdentity.ts'

export type TransparentOcclusion = NonNullable<
  Awaited<ReturnType<typeof createTransparentOcclusion>>
>

/** What the test borrows from the rest of the frame: the Hi-Z pyramid it just built and its
 *  levels uniform, and the compact's verdict buffer. */
type TransparentOcclusionSources = {
  pyramid: () => GPUTextureView | undefined
  levels: GPUBuffer
  /** The verdict buffer the compact owns, read at each image: it follows the compact's growth. */
  occluded: () => GPUBuffer
}

/** The view an image was tested under, as the test keeps it and its audit reports it
 *  (`../../blend/transparent/occlusionAudit.ts`). */
export type AuditView = {
  /** Width in pixels. */
  width: number
  /** Height in pixels. */
  height: number
  /** Nearest distance. */
  near: number
  /** View elements in double precision, as the image posted them. */
  view: Float64Array
  /** The camera's view-projection. */
  viewProj: Float64Array
}

/** What an image tells the test before its compute pass (`begin`): the frame its boxes are
 *  projected under, what the image does with its occlusion (`CullStep`), and whether it walks the
 *  pyramid as the reference does (`hizTransparentTest` `'reference'`) or at the finer level. */
export type OcclusionFrame = ProjectionFrame & { cull: CullStep; referenceTest: boolean }

/**
 * Occlusion of transparent clusters, done by the GPU, on the current frame's pyramid.
 *
 * It owns three buffers: the world corners of each transparent-table entry, as two
 * single-precision values, derived on the GPU only when a world matrix changes, one bit per entry that
 * is never culled (`neverCulled`), which it never rejects, and the frame's projection uniform, which
 * it writes once an image (`begin`, `packProjectionUniform`). The pyramid, its levels and the
 * verdict buffer are borrowed.
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
    const uniforms = device.createBuffer({
      label: 'Trillion3D transparent occlusion uniform v1',
      size: PROJECTION_UNI.words * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    o = {
      ...{ device, entryCount, sources, ...buffers, ...made, uniforms },
      ...{ bound: createWebgpuBindIdentity(), bindGroup: undefined, disposed: false },
      held: createHeldCopy(device, 'Trillion3D held transparent verdicts'),
      // A thread an entry.
      groups: workgroupCount(entryCount, WORKGROUP_THREADS),
      writeUniform: createProjectionUniformWriter(),
      // Copied, the camera's matrices being rewritten by the next image: the audit reads the last
      // frame tested, never an earlier one.
      kept: {
        width: 0,
        height: 0,
        near: 0,
        view: new Float64Array(16),
        viewProj: new Float64Array(16),
      },
      lastFrame: undefined,
      cull: 'follow',
      referenceTest: false,
      drawsKept: false,
    }
    return {
      /** The view the last image tested was projected under; `undefined` before the first. */
      get lastFrame() {
        return o.lastFrame
      },
      begin: (frame: OcclusionFrame) => beginOcclusion(o, frame),
      /** The world corners of each entry, the entries pass's (`../../blend/transparent/
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
        o.held.drop()
        o.uniforms.destroy()
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
  /** The verdicts a frozen cut tested, kept aside (`./heldCopy.ts`). */
  held: HeldCopy
  /** The frame's projection uniform (`begin`) and its writer. */
  uniforms: GPUBuffer
  writeUniform: ReturnType<typeof createProjectionUniformWriter>
  /** The view the last image tested was projected under (`kept`), once one was. */
  kept: AuditView
  lastFrame: AuditView | undefined
  /** What the image does with its occlusion (`OcclusionFrame.cull`). */
  cull: CullStep
  /** The pyramid walk the image tests with (`OcclusionFrame.referenceTest`). */
  referenceTest: boolean
  /** The image draws the verdicts a frozen cut kept again: it tests nothing. */
  drawsKept: boolean
}

/**
 * The image's frame, before its compute pass: what it does with its occlusion, and, unless it draws
 * a frozen cut's kept verdicts again — those images write neither, the uniform and the audit's frame
 * staying the image's that tested them —, its projection uniform written and its view kept.
 */
function beginOcclusion(o: Occlusion, frame: OcclusionFrame) {
  if (o.disposed) return
  o.cull = frame.cull
  o.referenceTest = frame.referenceTest
  o.drawsKept = frame.cull === 'held' && o.held.holds(o.sources.occluded())
  if (o.drawsKept) return
  o.writeUniform(o.device, o.uniforms, frame)
  const { kept } = o
  kept.width = frame.width
  kept.height = frame.height
  kept.near = frame.near
  kept.view.set(frame.view)
  kept.viewProj.set(frame.viewProj)
  o.lastFrame = kept
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

/** The test's layout and its two pipelines — the finer level's walk, the reference's —; undefined
 *  when its module fails. */
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
  const [pipeline, referencePipeline] = await Promise.all([
    buildComputeStage(device, [layout], module, 'testTransparentClusters'),
    buildComputeStage(device, [layout], module, 'testTransparentClusters', {
      [TRANSPARENT_REFERENCE_TEST]: 1,
    }),
  ])
  return { layout, pipeline, referencePipeline }
}

/**
 * The image's verdicts, as its cull says (`CullStep`): an image that draws a frozen cut's kept
 * verdicts again puts them back, or keeps every entry where it cannot — its test would read a
 * uniform it did not write (`beginOcclusion`); the first image of a frozen cut tests and keeps its
 * verdicts; an image that follows the camera drops them.
 */
function encodeOcclusion(o: Occlusion, encoder: GPUCommandEncoder, pyramidFresh: boolean) {
  if (o.disposed) return
  const occluded = o.sources.occluded()
  if (o.drawsKept) {
    if (o.held.restore(encoder, occluded)) return
    encoder.clearBuffer(occluded, 0, o.entryCount * 4)
  } else testOcclusion(o, encoder, pyramidFresh, occluded)
  if (o.cull === 'held') o.held.keep(encoder, occluded)
  else if (o.cull === 'follow') o.held.drop()
}

/** Each entry's verdict on this image's pyramid; all kept without a fresh one. */
function testOcclusion(
  o: Occlusion,
  encoder: GPUCommandEncoder,
  pyramidFresh: boolean,
  occluded: GPUBuffer,
) {
  const { sources } = o
  const pyramid = pyramidFresh ? sources.pyramid() : undefined
  if (!pyramid) {
    encoder.clearBuffer(occluded, 0, o.entryCount * 4)
    return
  }
  const { next } = o.bound
  next[0] = pyramid
  next[1] = occluded
  next[2] = o.corners
  next[3] = o.unculled
  next[4] = o.uniforms
  next[5] = sources.levels
  if (o.bound.moved())
    o.bindGroup = o.device.createBindGroup({
      layout: o.layout,
      entries: sequentialEntries([
        { buffer: o.corners },
        pyramid,
        { buffer: occluded },
        { buffer: o.uniforms },
        { buffer: o.unculled },
        { buffer: sources.levels },
      ]),
    })
  const pass = encoder.beginComputePass({ label: TRANSPARENT_OCCLUSION_PASS })
  pass.setPipeline(o.referenceTest ? o.referencePipeline : o.pipeline)
  pass.setBindGroup(0, o.bindGroup!)
  dispatchRows(pass, o.groups)
  pass.end()
}
