import type { GuideSet } from './guideSet.ts'
import { GUIDE_INSTANCE_FLOATS } from './guidePack.ts'
import { GUIDE_UNIFORM_FLOATS, GUIDE_WGSL, writeGuideView } from './guideShaders.ts'
import { preparedPipeline } from '../lighting/deferred/fullscreen.ts'
import { GUIDE_PASS } from '../diagnostic/stage/passLabels.ts'
import {
  computeBufferEntry,
  computeTextureEntry,
  sequentialEntries,
} from '../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../gpu/bind/bindIdentity.ts'
import { heldBuffers } from '../gpu/core/heldBuffers.ts'

/** Label of the guide pass: its GPU time is read under this name, apart from the beauty passes. */

const STRIDE = GUIDE_INSTANCE_FLOATS * 4

/** The guide pass's group layout and its pipeline, compiled off the frame. */
function createGuidePipeline(device: GPUDevice) {
  const module = device.createShaderModule({ label: GUIDE_PASS, code: GUIDE_WGSL })
  const layout = device.createBindGroupLayout({
    label: GUIDE_PASS,
    entries: [
      computeBufferEntry(0, 'uniform', GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT),
      computeTextureEntry(1, 'depth', '2d', GPUShaderStage.FRAGMENT),
    ],
  })
  const pipeline = preparedPipeline(device, {
    label: GUIDE_PASS,
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: {
      module,
      entryPoint: 'vertexMain',
      buffers: [
        {
          arrayStride: STRIDE,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'unorm8x4' },
            { shaderLocation: 3, offset: 28, format: 'float32' },
          ],
        },
      ],
    },
    fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
  }).ask()
  return { layout, pipeline }
}

const guideTarget = { loadOp: 'load', storeOp: 'store' } as GPURenderPassColorAttachment
const GUIDE: GPURenderPassDescriptor = { label: GUIDE_PASS, colorAttachments: [guideTarget] }

/** The `count` instances drawn over `color`: six vertices each. */
function drawGuides(
  encoder: GPUCommandEncoder,
  color: GPUTextureView,
  pipeline: GPURenderPipeline,
  buffers: { group: GPUBindGroup; instances: GPUBuffer },
  count: number,
) {
  guideTarget.view = color
  const pass = encoder.beginRenderPass(GUIDE)
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, buffers.group)
  pass.setVertexBuffer(0, buffers.instances)
  pass.draw(6, count)
  pass.end()
}

/** The pass's uniform and instance buffers, and the group binding the uniform and the depth. */
function createGuideBuffers(device: GPUDevice, layout: GPUBindGroupLayout) {
  let uniform: GPUBuffer | undefined,
    instances: GPUBuffer | undefined,
    group: GPUBindGroup | undefined,
    uploaded: unknown
  /** The group binds the uniform and the depth target, made again when one moved — a resize gives
   *  the depth a new view (`createWebgpuBindIdentity`). */
  const bound = createWebgpuBindIdentity()
  const bind = (depth: GPUTextureView) => {
    bound.next[0] = uniform
    bound.next[1] = depth
    if (bound.moved())
      group = device.createBindGroup({
        layout,
        entries: sequentialEntries([{ buffer: uniform! }, depth]),
      })
  }
  /** The pass's instance buffer, grown to the next power of two, the outgrown one retired. */
  const held = heldBuffers()
  /** The instances, uploaded again only when the set packed anew. */
  const upload = (packed: ReturnType<GuideSet['pack']>) => {
    if (uploaded === packed) return
    const usage = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    instances = held.grow(device, GUIDE_PASS, packed.count * STRIDE, usage)
    device.queue.writeBuffer(instances, 0, packed.data)
    uploaded = packed
  }
  return {
    /** The uniform made on the first image, the instances uploaded, the group bound to `depth`. */
    prepare(packed: ReturnType<GuideSet['pack']>, depth: GPUTextureView) {
      uniform ??= device.createBuffer({
        label: GUIDE_PASS,
        size: GUIDE_UNIFORM_FLOATS * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      upload(packed)
      bind(depth)
    },
    get uniform() {
      return uniform!
    },
    get group() {
      return group!
    },
    get instances() {
      return instances!
    },
    dispose() {
      uniform?.destroy()
      held.drop(device, GUIDE_PASS)
      uniform = instances = group = uploaded = undefined
    },
  }
}

/**
 * The WebGPU guide pass. Nothing exists until a guide is shown: the frame entry that first finds
 * one makes the pass (`../frame/loop/framePipelines.ts`), whose pipeline compiles off the frame
 * from then, the frame held on it; its buffers are made by the first image it draws. It draws on
 * the display colour target, AFTER temporal accumulation and composition, with the camera's
 * unjittered view-projection: the guides never enter the history the next image reprojects, so a
 * moving camera cannot smear them, and a still one does not make them shimmer. It reads the opaque
 * depth as a texture and tests against it in the shader, allowing the depth the image's jitter
 * moved (`jitterSlack`, `guideShaders.ts`): the scene was drawn jittered, the guides are not.
 */
export function createWebgpuGuidePass(device: GPUDevice) {
  const { layout, pipeline } = createGuidePipeline(device)
  const buffers = createGuideBuffers(device, layout)
  const view = new Float32Array(GUIDE_UNIFORM_FLOATS)
  return {
    /**
     * Draws the visible guides over `color`, tested against `depth`, seen through the camera's
     * own view-projection — never the jittered one — at the host's `pixelRatio`; `jitter` is the
     * pixel offset `depth` was drawn with, `scene` the size it was drawn at, the display's by
     * default. Returns false, and encodes nothing, when none is shown.
     */
    encode(
      encoder: GPUCommandEncoder,
      guides: GuideSet,
      color: GPUTextureView,
      depth: GPUTextureView,
      camera: { viewProjection: ArrayLike<number> },
      [width, height]: readonly number[],
      pixelRatio: number,
      jitter: ArrayLike<number>,
      scene?: ArrayLike<number>,
    ) {
      // Single step, before anything is packed, uploaded or counted drawn: the pipeline was asked at
      // creation (`askGuidePass`), the frames waiting for it.
      const drawing = pipeline.get()
      if (!drawing) return false
      const packed = guides.pack()
      if (!packed.count) return false
      buffers.prepare(packed, depth)
      const { anchor } = packed
      writeGuideView(view, camera.viewProjection, anchor, width, height, pixelRatio, jitter, scene)
      device.queue.writeBuffer(buffers.uniform, 0, view)
      drawGuides(encoder, color, drawing, buffers, packed.count)
      return true
    },
    dispose: buffers.dispose,
  }
}

export type WebgpuGuidePass = ReturnType<typeof createWebgpuGuidePass>
