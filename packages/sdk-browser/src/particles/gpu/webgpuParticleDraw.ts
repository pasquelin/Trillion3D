import { PARTICLE_BLENDS, type ParticlePool } from '../../../../sdk-core/src/fluids/particles.ts'
import { checkShaderModule } from '../../gpu/core/shaderModule.ts'
import {
  buildRenderPipeline,
  preparedPipeline,
  type PreparedPipeline,
} from '../../lighting/deferred/fullscreen.ts'
import { HOLDOUT_TARGET } from '../../blend/holdout.ts'
import { preparedPipelines } from '../../gpu/core/preparedPipelines.ts'
import { DRAW, DRAW_FLOATS, drawOrder, writeDrawWords, writeViewAxes } from '../drawWords.ts'
import { displayMaskLayout, type DisplayFilter } from '../../blend/display/displayFilter.ts'
import { DISC_TOPOLOGY, PARTICLE_DRAW_WGSL, particleDrawShader } from './particlesWgsl.ts'
import type { Clipping } from '../../gpu/core/clipDistances.ts'
import { DIRECT_AT } from '../../lighting/deferred/view.ts'
import { particleTargets } from '../particleTargets.ts'
import { PARTICLE_DRAW_PASS } from '../../diagnostic/stage/passLabels.ts'
import {
  sequentialEntries,
  computeBufferEntry,
  computeTextureEntry,
} from '../../gpu/core/computeBindings.ts'

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
      computeBufferEntry(0, 'uniform', VERTEX | FRAGMENT),
      computeBufferEntry(1, 'read-only-storage', VERTEX),
      computeTextureEntry(2, 'depth', '2d', FRAGMENT),
    ],
  })
}

/** The draw's pipelines on `layout`: the plain one of each blend, compiled in the background once
 *  its module's check passes, and the routed ones, prepared when asked. `fail` hears a pipeline
 *  not made, `failed` holding from then on. `clipping`, the way the module cuts at a view's plane
 *  (the project switch, `../../gpu/core/clipDistances.ts`): none, the text holds none of it. */
function buildPipelines(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  fail: (error: unknown) => void,
  clipping?: Clipping,
) {
  const plain: Partial<Record<ParticlePool['blend'], GPURenderPipeline>> = {}
  // One module, its two fragment entries (`PARTICLE_DRAW_WGSL`): made at once, so a routed
  // pipeline asked before its check settles builds on it.
  const module = device.createShaderModule({
      label: 'PARTICLE_DRAW',
      code: clipping ? particleDrawShader(clipping) : PARTICLE_DRAW_WGSL,
    }),
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
  // The alpha holdout's accumulation, made at the first image that draws it.
  let holdoutPipeline: PreparedPipeline<GPURenderPipeline> | undefined
  const holdout = () =>
    (holdoutPipeline ??= preparedPipeline(device, {
      label: `${PARTICLE_DRAW_PASS} alpha holdout`,
      layout: plainLayout,
      vertex: { module, entryPoint: 'vs' },
      primitive: { topology: DISC_TOPOLOGY },
      fragment: { module, entryPoint: 'fsHoldout', targets: [HOLDOUT_TARGET] },
    }))
  const made = { plain, routed, holdout, failed: false }
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

const drawTarget = { loadOp: 'load', storeOp: 'store' } as GPURenderPassColorAttachment
const drawTargets: GPURenderPassColorAttachment[] = [drawTarget]
const DRAW_PASS: GPURenderPassDescriptor = {
  label: PARTICLE_DRAW_PASS,
  colorAttachments: drawTargets,
}

/** The draw's pass over `target` and the display layers' targets when `filter` routes, all loaded; its viewport the
 *  `width × height` the image draws in, set once for every pool. */
function beginDraw(
  encoder: GPUCommandEncoder,
  target: GPUTextureView,
  filter: DisplayFilter | undefined,
  width: number,
  height: number,
) {
  drawTarget.view = target
  drawTargets.length = 1
  if (filter) drawTargets.push(...filter.attachments())
  const pass = encoder.beginRenderPass(DRAW_PASS)
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
    const entries = sequentialEntries([...buffers, depth])
    kept.drawn = device.createBindGroup({ label: PARTICLE_DRAW_PASS, layout, entries })
    kept.depth = depth
  }
  return kept.drawn!
}

/** How the image shows a pool, after its own words: `tone`'s scale and curve (1 and 0 without
 *  one) and pre-exposure (1), the tone table's baking words `bake`, whether it is `unlit`, and the
 *  `width × height` the image draws in. */
function writeShowWords(
  words: Float32Array,
  tone: ArrayLike<number> | undefined,
  bake: ArrayLike<number> | undefined,
  unlit: boolean,
  width: number,
  height: number,
) {
  words[DRAW.at.exposure] = tone?.[DIRECT_AT.shown] ?? 1
  words[DRAW.at.curve] = tone?.[4] ?? 0
  words[DRAW.at.unlit] = unlit ? 1 : 0
  words[DRAW.at.drawn] = width
  words[DRAW.at.drawn + 1] = height
  words[DRAW.at.preExposure] = tone?.[DIRECT_AT.preExposure] ?? 1
  if (bake) words.set(bake, DRAW.at.bake)
}

/** What an image draws the pools with: `encoder`, the translucency `target` of `size` — the size the
 *  image draws in (`renderScale.ts`) —, the opaque `depth` that softens their edge, `viewProj` and the camera's
 *  `world`, which gives the discs their axes, and `eye`, which orders the pools, `filter`
 *  routing a pool through the display layers where its mask is set, `tone` (exposure, curve) and
 *  `bake` (the colours the table gives), or raw when `unlit`. */
export type ParticleView = {
  encoder: GPUCommandEncoder
  target: GPUTextureView
  depth: GPUTextureView
  size: readonly number[]
  viewProj: ArrayLike<number>
  world: ArrayLike<number>
  eye: ArrayLike<number>
  filter?: DisplayFilter
  tone?: ArrayLike<number>
  /** The pools of a set of passes of the image alone (`ParticlePool.translucencyPass`, the bits of
   *  `translucencyPassBit`); every pool without it. */
  passes?: number
  /** The tone table's baking words (`../../lighting/toneLut.ts`), which a disc routed through the
   *  display layers (`filter`) shows its colour through; none else reads them. */
  bake?: ArrayLike<number>
  unlit?: boolean
  /** The view's clip plane in the world, `dot(xyz, p) + w` at least 0 drawn, all zero for a view
   *  that clips nothing (`../../frame/render/viewClip.ts`); none when absent. */
  clipPlane?: ArrayLike<number>
  /** The alpha holdout's target (`../../blend/holdout.ts`): the premultiplied pools then lay what they let
   *  through there, `target` unused, the others nothing. */
  holdout?: GPUTextureView
}

/** The WebGPU particle draw: one pass over the translucency target, one indirect instanced draw per live
 *  pool — its instances the window of live slots its step wrote —, the opaque depth read for the
 *  soft edge. Its pipelines compile in the background, a pool drawn once its blend's has arrived;
 *  those routed through the display layers are asked by the frame entry that draws such an image
 *  (`askRouted`), the frame held until they land. `fail` hears a pipeline not made; the step then
 *  refuses the pools (`refused`). */
export function createWebgpuParticleDraw(
  device: GPUDevice,
  stateOf: (pool: ParticlePool) => DrawState | undefined,
  fail: (error: unknown) => void,
  clipping?: Clipping,
) {
  const layout = drawLayout(device),
    made = buildPipelines(device, layout, fail, clipping)
  const words = new Float32Array(DRAW_FLOATS),
    order: ParticlePool[] = []
  return {
    /** Draws `pools` as `view` says (`ParticleView`). Returns the draws encoded, none without a
     *  live particle. */
    draw(pools: readonly ParticlePool[], view: ParticleView) {
      if (made.failed) return 0
      const { encoder, filter, eye } = view,
        [width, height] = view.size
      // The same for every pool, beside the words each pool writes (`writeDrawWords`).
      writeShowWords(words, view.tone, filter && view.bake, view.unlit ?? false, width, height)
      writeViewAxes(words, view.world)
      let pass: GPURenderPassEncoder | undefined,
        draws = 0
      for (const pool of drawOrder(pools, eye, order, view.passes)) {
        if (view.holdout && pool.blend !== 'premultiplied') continue
        const pipeline = view.holdout
            ? made.holdout().get()
            : filter
              ? made.routed.of(pool.blend).get()
              : made.plain[pool.blend],
          kept = stateOf(pool)
        if (!pipeline || !kept) continue
        writeDrawWords(words, pool, view.viewProj, view.clipPlane)
        device.queue.writeBuffer(kept.draw, 0, words)
        pass ??= beginDraw(
          encoder,
          view.holdout ?? view.target,
          view.holdout ? undefined : filter,
          width,
          height,
        )
        if (filter && !view.holdout) pass.setBindGroup(1, filter.maskGroup)
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
    /** Asks the alpha holdout's accumulation off the frame, as `askRouted` does. */
    askHoldout() {
      made.holdout().ask()
    },
  }
}
