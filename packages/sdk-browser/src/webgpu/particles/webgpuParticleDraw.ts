import { PARTICLE_BLENDS, type ParticlePool } from '../../../../sdk-core/src/fluids/particles.ts'
import { checkShaderModule } from '../../gpu/core/shaderModule.ts'
import {
  buildRenderPipeline,
  preparedPipeline,
  preparedPipelines,
} from '../../lighting/deferred/fullscreen.ts'
import { DRAW_FLOATS, drawOrder, writeDrawWords } from '../../particles/drawWords.ts'
import { displayMaskLayout, type DisplayFilter } from '../blend/displayFilter.ts'
import { DISC_TOPOLOGY, PARTICLE_DRAW_WGSL } from './particlesWgsl.ts'
import { particleTargets } from '../../particles/particleTargets.ts'
import { PARTICLE_DRAW_PASS } from '../../stage/passLabels.ts'

/** What the draw keeps in a pool's step state: its words, its group and the depth it was made on. */
export type DrawState = {
  state: GPUBuffer
  draw: GPUBuffer
  drawn?: GPUBindGroup
  depth?: GPUTextureView
}

/** The draw's group layout: its words, the pool's state and the opaque depth. */
const drawLayout = (device: GPUDevice) => {
  const { VERTEX, FRAGMENT } = GPUShaderStage
  return device.createBindGroupLayout({
    label: PARTICLE_DRAW_PASS,
    entries: [
      { binding: 0, visibility: VERTEX | FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: FRAGMENT, texture: { sampleType: 'depth' } },
    ],
  })
}

/** The draw's pipelines on `layout`: the plain one of each blend, compiled in the background once
 *  its module's check passes, and the routed ones, prepared when asked. `fail` hears a pipeline
 *  not made, `failed` holding from then on. */
function buildPipelines(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  fail: (error: unknown) => void,
) {
  const plain: Partial<Record<ParticlePool['blend'], GPURenderPipeline>> = {}
  // One module, its two fragment entries (`PARTICLE_DRAW_WGSL`): made at once, so a routed
  // pipeline asked before its check settles builds on it.
  const module = device.createShaderModule({ label: 'PARTICLE_DRAW', code: PARTICLE_DRAW_WGSL }),
    plainLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  let routedLayout: GPUPipelineLayout | undefined
  /** The routed pipeline of each blend, its layout made by the first one asked. */
  const routed = preparedPipelines((blend: ParticlePool['blend']) =>
    preparedPipeline(device, {
      label: `${PARTICLE_DRAW_PASS} ${blend} routed`,
      layout: (routedLayout ??= device.createPipelineLayout({
        bindGroupLayouts: [layout, displayMaskLayout(device)],
      })),
      vertex: { module, entryPoint: 'vs' },
      primitive: { topology: DISC_TOPOLOGY },
      fragment: {
        module,
        entryPoint: 'fsRouted',
        constants: { DISPLAY_ROUTE: 1 },
        targets: particleTargets(blend, true),
      },
    }),
  )
  const made = { plain, routed, failed: false }
  checkShaderModule(module, 'PARTICLE_DRAW')
    .then(() =>
      Promise.all(
        PARTICLE_BLENDS.map(async (blend) => {
          plain[blend] = await buildRenderPipeline(device, {
            label: `${PARTICLE_DRAW_PASS} ${blend}`,
            layout: plainLayout,
            vertex: { module, entryPoint: 'vs' },
            primitive: { topology: DISC_TOPOLOGY },
            fragment: { module, entryPoint: 'fs', targets: particleTargets(blend) },
          })
        }),
      ),
    )
    .catch((error) => ((made.failed = true), fail(error)))
  return made
}

/** The draw's pass over `target`, the display layers' targets when `filter` routes, and
 *  `reactive`, all loaded; its viewport the `width × height` the image draws in, set once for
 *  every pool. */
function beginDraw(
  encoder: GPUCommandEncoder,
  target: GPUTextureView,
  reactive: GPUTextureView,
  filter: DisplayFilter | undefined,
  width: number,
  height: number,
) {
  const pass = encoder.beginRenderPass({
    label: PARTICLE_DRAW_PASS,
    colorAttachments: [
      { view: target, loadOp: 'load', storeOp: 'store' },
      ...(filter ? filter.attachments() : []),
      { view: reactive, loadOp: 'load', storeOp: 'store' },
    ],
  })
  pass.setViewport(0, 0, width, height, 0, 1)
  return pass
}

/** The pool's group on `layout`, made again only when the depth target changed. */
function drawGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  kept: DrawState,
  depth: GPUTextureView,
) {
  if (kept.depth !== depth) {
    const buffers = [kept.draw, kept.state].map((buffer) => ({ buffer }))
    const entries = [...buffers, depth].map((resource, binding) => ({ binding, resource }))
    kept.drawn = device.createBindGroup({ label: PARTICLE_DRAW_PASS, layout, entries })
    kept.depth = depth
  }
  return kept.drawn!
}

/** How the image shows a pool, after its own words: `tone`'s exposure and curve (1 and 0 without
 *  one), whether it is `unlit`, and the `width × height` the image draws in. */
function writeShowWords(
  words: Float32Array,
  tone: ArrayLike<number> | undefined,
  unlit: boolean,
  width: number,
  height: number,
) {
  words[41] = tone?.[3] ?? 1
  words[42] = tone?.[4] ?? 0
  words[43] = unlit ? 1 : 0
  words[44] = width
  words[45] = height
}

/** What an image draws the pools with: `encoder`, the lit image `target` of `size` — the size the
 *  image draws in (`renderScale.ts`) —, `reactive` whose green takes their coverage
 *  (`asIsShare.ts`), the opaque `depth` that softens their edge, `viewProj` and `eye`, `filter`
 *  routing a pool through the display layers where its mask is set, and `tone` (exposure, curve),
 *  or raw when `unlit`. */
export type ParticleView = {
  encoder: GPUCommandEncoder
  target: GPUTextureView
  reactive: GPUTextureView
  depth: GPUTextureView
  size: readonly number[]
  viewProj: ArrayLike<number>
  eye: ArrayLike<number>
  filter?: DisplayFilter
  tone?: ArrayLike<number>
  unlit?: boolean
}

/** The WebGPU particle draw: one pass over the lit image, one indirect instanced draw per live
 *  pool — its instances the window of live slots its step wrote —, the opaque depth read for the
 *  soft edge. Its pipelines compile in the background, a pool drawn once its blend's has arrived;
 *  those routed through the display layers are asked by the frame entry that draws such an image
 *  (`askRouted`), the frame held until they land. `fail` hears a pipeline not made; the step then
 *  refuses the pools (`refused`). */
export function createWebgpuParticleDraw(
  device: GPUDevice,
  stateOf: (pool: ParticlePool) => DrawState | undefined,
  fail: (error: unknown) => void,
) {
  const layout = drawLayout(device),
    made = buildPipelines(device, layout, fail)
  const words = new Float32Array(DRAW_FLOATS),
    order: ParticlePool[] = []
  return {
    /** Draws `pools` as `view` says (`ParticleView`). Returns the draws encoded, none without a
     *  live particle. */
    draw(pools: readonly ParticlePool[], view: ParticleView) {
      if (made.failed) return 0
      const { encoder, filter, eye } = view,
        [width, height] = view.size
      // The same for every pool, beside the words each pool writes (`writeDrawWords`, 0–40).
      writeShowWords(words, view.tone, view.unlit ?? false, width, height)
      let pass: GPURenderPassEncoder | undefined,
        draws = 0
      for (const pool of drawOrder(pools, eye, order)) {
        const pipeline = filter ? made.routed.of(pool.blend).get() : made.plain[pool.blend],
          kept = stateOf(pool)
        if (!pipeline || !kept) continue
        writeDrawWords(words, pool, view.viewProj, eye)
        device.queue.writeBuffer(kept.draw, 0, words)
        pass ??= beginDraw(encoder, view.target, view.reactive, filter, width, height)
        if (filter) pass.setBindGroup(1, filter.maskGroup)
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, drawGroup(device, layout, kept, view.depth))
        // The live slots' span the step wrote (`particlesWgsl`): no slot past it is drawn.
        pass.drawIndirect(kept.state, 0)
        draws++
      }
      pass?.end()
      return draws
    },
    refused: () => made.failed,
    /** Asks the routed pipelines off the frame: the frame entry's, before an image routes a pool
     *  through the display layers. */
    askRouted() {
      for (const blend of PARTICLE_BLENDS) made.routed.of(blend).ask()
    },
  }
}
