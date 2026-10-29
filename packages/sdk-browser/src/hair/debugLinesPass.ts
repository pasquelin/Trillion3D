import { DISPLAY_FORMAT } from '../scene/targetFormats.ts'
import { preparedPipeline } from '../lighting/deferred/fullscreen.ts'
import { autoKernel } from '../gpu/core/computeStages.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'
import { DEBUG_LINE_FLOATS, type DebugLines } from './debugLines.ts'
import {
  DEBUG_GPU_LINES,
  DEBUG_LINE_KIND,
  DEBUG_LINES_DRAW_WGSL,
  DEBUG_LINES_GPU_WGSL,
  DEBUG_VIEW_FLOATS,
} from './debugLinesWgsl.ts'

const LABEL = `${HAIR_STRANDS_PASS_PREFIX}debug lines`
/** The width of a line in the display's pixels. */
const LINE_WIDTH = 2

const kernel = (entry: string) => autoKernel(`${LABEL} ${entry}`, DEBUG_LINES_GPU_WGSL, entry)
const KERNELS = {
  frusta: kernel('debugFrusta'),
  macro: kernel('debugMacroBoxes'),
  nodes: kernel('debugNodeBoxes'),
} as const

/** The boxes the GPU holds, each with how many there are and the buffer that describes them: the deep shadows' slots (`viewInfos`), the macro groups
 *  (`aabb`) and the voxel nodes (`nodes`). */
export interface DebugGpuBoxes {
  readonly frusta?: { readonly count: number; readonly viewInfos: GPUBuffer }
  readonly macro?: { readonly count: number; readonly aabb: GPUBuffer }
  readonly nodes?: { readonly count: number; readonly nodes: GPUBuffer }
}

/** Lines a kernel appended in a buffer of its own, and the indirect arguments of the draw that counts them (`../lighting/surfaceCache/sceneDebug/gpuLines.ts`);
 *  `depth` the opaque depth the lines of the world that are depth tested are drawn against. */
export interface DebugAppendedLines {
  readonly lines: GPUBuffer
  readonly args: GPUBuffer
  readonly depth?: GPUTextureView
}

/** What the lines pass binds for a kind of box: the buffer of its description, at the binding the kernel reads it from. */
const BOXES = [
  ['frusta', 2, (box: { viewInfos: GPUBuffer }) => box.viewInfos],
  ['macro', 3, (box: { aabb: GPUBuffer }) => box.aabb],
  ['nodes', 4, (box: { nodes: GPUBuffer }) => box.nodes],
] as const

/** The buffers of the lines pass: the lines, the viewer's block, and a block of counts for each kind of box. */
function createLineBuffers(device: GPUDevice) {
  const make = (label: string, size: number, usage: GPUBufferUsageFlags) =>
    device.createBuffer({
      label: `${LABEL} ${label}`,
      size,
      usage: usage | GPUBufferUsage.COPY_DST,
    })
  return {
    lines: make('lines', DEBUG_GPU_LINES.end * DEBUG_LINE_FLOATS * 4, GPUBufferUsage.STORAGE),
    view: make('view', DEBUG_VIEW_FLOATS * 4, GPUBufferUsage.UNIFORM),
    viewTranslucent: make('view translucent', DEBUG_VIEW_FLOATS * 4, GPUBufferUsage.UNIFORM),
    viewDepthTested: make('view depth tested', DEBUG_VIEW_FLOATS * 4, GPUBufferUsage.UNIFORM),
    counts: BOXES.map(() => make('count', 16, GPUBufferUsage.UNIFORM)),
  }
}

type LineBuffers = ReturnType<typeof createLineBuffers>

/** Empties the lines the GPU writes and has each kernel of `boxes` write its boxes, in a compute pass each. */
function encodeGpuBoxes(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  { lines, counts }: LineBuffers,
  boxes: DebugGpuBoxes,
) {
  const gpuBytes = (DEBUG_GPU_LINES.end - DEBUG_GPU_LINES.frusta) * DEBUG_LINE_FLOATS * 4
  encoder.clearBuffer(lines, DEBUG_GPU_LINES.frusta * DEBUG_LINE_FLOATS * 4, gpuBytes)
  BOXES.forEach(([name, binding, bufferOf], at) => {
    const box = boxes[name]
    const stage = KERNELS[name](device).get()
    if (!box || !box.count || !stage) return
    device.queue.writeBuffer(counts[at]!, 0, new Uint32Array([box.count, 0, 0, 0]))
    const pass = encoder.beginComputePass({ label: `${LABEL} ${name}` })
    pass.setPipeline(stage)
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: stage.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: counts[at]! } },
          { binding: 1, resource: { buffer: lines } },
          { binding, resource: { buffer: bufferOf(box as never) } },
        ],
      }),
    )
    pass.dispatchWorkgroups(1)
    pass.end()
  })
}

/**
 * THE LINES OF THE DEBUG VIEWS OVER THE DISPLAY: the host's lines (`DebugLines`) and the boxes the GPU writes (`DebugGpuBoxes`) in one buffer,
 * drawn as quads of `LINE_WIDTH` pixels with no depth test, over the image. Made when a view is first shown; its pipeline compiles off the frame.
 */
export function createDebugLinesGpu(device: GPUDevice) {
  const module = device.createShaderModule({ label: LABEL, code: DEBUG_LINES_DRAW_WGSL })
  // One pipeline for the lines over everything, one for those drawn against the opaque depth.
  const pipelineOf = (fragment: string) =>
    preparedPipeline(device, {
      label: `${LABEL} ${fragment}`,
      layout: 'auto',
      vertex: { module, entryPoint: 'debugLineVs' },
      fragment: {
        module,
        entryPoint: fragment,
        // A colour of less than full alpha is laid over the image (the tiles' fill).
        targets: [
          {
            format: DISPLAY_FORMAT,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'zero', dstFactor: 'one' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    }).ask()
  const pipeline = pipelineOf('debugLineFs')
  const depthPipeline = pipelineOf('debugLineDepthFs')
  const buffers = createLineBuffers(device)
  const viewWords = new Float32Array(DEBUG_VIEW_FLOATS)
  return {
    /**
     * Draws over `target` (`size` display pixels) the lines of `drawn` and the boxes of `boxes`, seen through `viewProjection`
     * (clip from the world relative to the eye), then the lines a kernel `appended`, as many as its arguments count.
     */
    encode(
      encoder: GPUCommandEncoder,
      target: GPUTextureView,
      size: readonly [number, number],
      viewProjection: ArrayLike<number>,
      drawn: DebugLines,
      boxes: DebugGpuBoxes,
      appended?: DebugAppendedLines,
    ) {
      const draw = pipeline.get()
      if (!draw) return
      viewWords.set(viewProjection)
      viewWords.set([size[0], size[1], LINE_WIDTH], 16)
      device.queue.writeBuffer(buffers.view, 0, viewWords)
      viewWords[19] = DEBUG_LINE_KIND.translucent
      device.queue.writeBuffer(buffers.viewTranslucent, 0, viewWords)
      viewWords[19] = DEBUG_LINE_KIND.depthTested
      device.queue.writeBuffer(buffers.viewDepthTested, 0, viewWords)
      viewWords[19] = DEBUG_LINE_KIND.opaque
      device.queue.writeBuffer(buffers.lines, 0, drawn.data, 0, drawn.count * DEBUG_LINE_FLOATS)
      encodeGpuBoxes(device, encoder, buffers, boxes)
      const pass = encoder.beginRenderPass({
        label: LABEL,
        colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
      })
      pass.setPipeline(draw)
      pass.setBindGroup(
        0,
        device.createBindGroup({
          layout: draw.getBindGroupLayout(0),
          entries: sequentialEntries([{ buffer: buffers.view }, { buffer: buffers.lines }]),
        }),
      )
      if (drawn.count) pass.draw(6, drawn.count, 0, 0)
      pass.draw(6, DEBUG_GPU_LINES.end - DEBUG_GPU_LINES.frusta, 0, DEBUG_GPU_LINES.frusta)
      if (appended) {
        // The opaque lines first, then the translucent ones from the same lines, each in an indirect draw of its own.
        for (const uniform of [buffers.view, buffers.viewTranslucent]) {
          pass.setBindGroup(
            0,
            device.createBindGroup({
              layout: draw.getBindGroupLayout(0),
              entries: sequentialEntries([{ buffer: uniform }, { buffer: appended.lines }]),
            }),
          )
          pass.drawIndirect(appended.args, 0)
        }
        // Then those against the depth: the lines the opaque depth hides are dropped by the pixel.
        const againstDepth = depthPipeline.get()
        if (againstDepth && appended.depth) {
          pass.setPipeline(againstDepth)
          pass.setBindGroup(
            0,
            device.createBindGroup({
              layout: againstDepth.getBindGroupLayout(0),
              entries: sequentialEntries([
                { buffer: buffers.viewDepthTested },
                { buffer: appended.lines },
                appended.depth,
              ]),
            }),
          )
          pass.drawIndirect(appended.args, 0)
        }
      }
      pass.end()
    },
    dispose() {
      buffers.lines.destroy()
      buffers.view.destroy()
      buffers.viewTranslucent.destroy()
      buffers.viewDepthTested.destroy()
      for (const count of buffers.counts) count.destroy()
    },
  }
}

/** The lines pass of the debug views (`createDebugLinesGpu`). */
export type DebugLinesGpu = ReturnType<typeof createDebugLinesGpu>
