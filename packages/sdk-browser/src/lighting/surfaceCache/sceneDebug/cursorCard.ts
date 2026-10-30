import { updateTilesOf } from '../../../../../sdk-core/src/lighting/surfaceCache/lightingMath.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { computeBufferEntry } from '../../../gpu/core/computeBindings.ts'
import { uniformBlock } from '../../../gpu/core/uniformBlock.ts'
import { startedComputeStages } from '../../../gpu/core/computeStages.ts'
import { createCachedGroup } from '../../../gpu/bind/cachedGroup.ts'
import { oncePerDeviceKey } from '../../../gpu/core/oncePerDevice.ts'
import { hasFloat32Filterable } from '../../../gpu/core/float32Filterable.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { DISPLAY_FORMAT } from '../../../scene/targetFormats.ts'
import { preparedPipeline } from '../../deferred/fullscreen.ts'
import {
  surfaceHitCardsEntries,
  surfaceHitCardsLayoutEntries,
  surfaceHitEntries,
  surfaceHitLayoutEntries,
} from '../hitWgsl.ts'
import { surfaceHitReads } from '../frame.ts'
import { surfaceCacheLightOf } from '../light.ts'
import { VISUALIZE_MODE } from '../visualizeModes.ts'
import type { SceneDebug } from './views.ts'
import type { GpuLines } from './gpuLines.ts'
import { visualizeTonemapBindings } from './visualizeTonemap.ts'
import { toneReadEntries } from '../../toneLutRead.ts'
import {
  CURSOR_CARD_BINDINGS as B,
  CURSOR_CARD_FOUND_WORDS,
  CURSOR_CARD_PREVIEW,
  CURSOR_CARD_PREVIEW_BINDINGS as P,
  CURSOR_CARD_QUERY_WORDS,
  cursorCardHit,
  cursorCardPreviewHit,
  cursorCardPreviewWgsl,
  cursorCardWgsl,
} from './cursorCardWgsl.ts'

/**
 * THE CARD UNDER THE CURSOR over the image (`cursorCardWgsl.ts`): the kernels that find it and append the boxes of the cards and tiles, and the preview of its layer drawn at the
 * bottom left of the display. The layer `surfaceCacheCursorCardLayer` names (0 the albedo, 1 the normal, 2 the emission, 3 the direct light, 4 the indirect light) is one of the cache's
 * layer modes (`visualizeModes.ts`).
 */

const LABEL = 'Trillion3D debug cursor card'
const LAYER_MODES = [
  VISUALIZE_MODE.albedo,
  VISUALIZE_MODE.normals,
  VISUALIZE_MODE.emissive,
  VISUALIZE_MODE.directLighting,
  VISUALIZE_MODE.indirectLighting,
] as const
const WORKGROUP = 64
/** The found words of a view with no cursor: no card. */
const NO_CARD = new Uint32Array(CURSOR_CARD_FOUND_WORDS).fill(0xffffffff)

/** The pick and outlines kernels for a device and the format the light is stored in. */
const pickOf = oncePerDeviceKey((device: GPUDevice, light: string) => {
  const format = light as LightAtlasFormat
  const filterableMip = hasFloat32Filterable(device.features)
  const layout = device.createBindGroupLayout({
    label: LABEL,
    entries: [
      computeBufferEntry(B.query, 'uniform'),
      computeBufferEntry(B.found, 'storage'),
      computeBufferEntry(B.view, 'uniform'),
      computeBufferEntry(B.params, 'uniform'),
      computeBufferEntry(B.context, 'read-only-storage'),
      computeBufferEntry(B.lines, 'storage'),
      computeBufferEntry(B.count, 'storage'),
      ...surfaceHitLayoutEntries(cursorCardHit(), format, filterableMip),
    ],
  })
  const stages = startedComputeStages(
    device,
    LABEL,
    device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    device.createShaderModule({ label: LABEL, code: cursorCardWgsl(format, filterableMip) }),
    ['debugCursorCard', 'debugCardOutlines'] as const,
  )
  return { layout, stages }
})

/** The preview's layout and pipeline for the layer mode `mode`. */
const previewOf = oncePerDeviceKey((device: GPUDevice, key: string) => {
  const [light, mode, packed] = key.split('|') as [LightAtlasFormat, string, string]
  const hit = cursorCardPreviewHit(Number(mode), packed === 'true')
  const FRAGMENT = GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: `${LABEL} preview`,
    entries: [
      computeBufferEntry(P.query, 'uniform', FRAGMENT),
      computeBufferEntry(P.found, 'read-only-storage', FRAGMENT),
      computeBufferEntry(P.tone, 'uniform', FRAGMENT),
      ...toneReadEntries(P.tone + 1, FRAGMENT),
      ...surfaceHitCardsLayoutEntries(hit, light).map((entry) => ({
        ...entry,
        visibility: entry.visibility | FRAGMENT,
      })),
    ],
  })
  const module = device.createShaderModule({
    label: `${LABEL} preview`,
    code: cursorCardPreviewWgsl(light, Number(mode), hit.compressed === true),
  })
  return {
    layout,
    draw: preparedPipeline(device, {
      label: `${LABEL} preview`,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'fullscreen' },
      fragment: {
        module,
        entryPoint: 'cursorCardPreviewFs',
        targets: [{ format: DISPLAY_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }).ask(),
  }
})

/** What the card view keeps between images: the query's uniform and the found words, made at the first image the view is shown. */
export function createCursorCard(device: GPUDevice) {
  const query = uniformBlock(device, `${LABEL} query`, CURSOR_CARD_QUERY_WORDS * 4)
  const { f: floats, u: uints } = query.words
  const found = device.createBuffer({
    label: `${LABEL} found`,
    size: CURSOR_CARD_FOUND_WORDS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  // Whether the found words hold no card since the cursor went off: the pick rewrites them while it is on.
  let emptied = false
  const pickGroup = createCachedGroup()
  const previewGroup = createCachedGroup()
  /** Draws the preview of the layer `mode` with `made`'s pipeline `draw`. */
  function preview(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    size: readonly [number, number],
    made: ReturnType<typeof previewOf>,
    draw: GPURenderPipeline,
    hit: ReturnType<typeof cursorCardPreviewHit>,
    tone: NonNullable<ReturnType<typeof visualizeTonemapBindings>>,
    reads: ReturnType<typeof surfaceHitReads>,
  ) {
    const pass = encoder.beginRenderPass({
      label: `${LABEL} preview`,
      colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
    })
    pass.setViewport(
      0,
      Math.max(0, size[1] - CURSOR_CARD_PREVIEW),
      Math.min(CURSOR_CARD_PREVIEW, size[0]),
      Math.min(CURSOR_CARD_PREVIEW, size[1]),
      0,
      1,
    )
    pass.setScissorRect(
      0,
      Math.max(0, size[1] - CURSOR_CARD_PREVIEW),
      Math.min(CURSOR_CARD_PREVIEW, size[0]),
      Math.min(CURSOR_CARD_PREVIEW, size[1]),
    )
    pass.setPipeline(draw)
    const preview = previewGroup.over(
      device,
      made.layout,
      [
        { binding: P.query, resource: { buffer: query.buffer } },
        { binding: P.found, resource: { buffer: found } },
        ...tone.resources.map((resource, k) => ({ binding: P.tone + k, resource })),
        ...surfaceHitCardsEntries(hit, reads.hit),
      ],
      `${LABEL} preview`,
    )
    pass.setBindGroup(0, preview)
    pass.draw(3)
    pass.end()
  }
  return {
    /** Finds the card under `cursor` and appends the boxes `view` asks to `lines`, then draws the preview of its layer over `target`; false where the cache had nothing to read yet. */
    encode(
      rt: WebgpuPagesRuntime,
      encoder: GPUCommandEncoder,
      lines: GpuLines,
      target: GPUTextureView,
      size: readonly [number, number],
      cursor: readonly [number, number],
      view: SceneDebug,
    ): boolean {
      const surface = rt.surfaceCache
      const context = surface?.lighting?.resources
      const deferred = rt.gpu.deferred
      if (!surface?.atlases || !context || !deferred) return false
      const light = surfaceCacheLightOf(rt, device)
      const kernels = pickOf(device, light)
      if (!kernels.stages.ready) return false
      const reads = surfaceHitReads(rt, device, undefined, light)
      const cursorOn = view.cursorCard
      // The preview needs the composition's table and its pipeline; the boxes need neither.
      const tone = cursorOn ? visualizeTonemapBindings(rt) : undefined
      const mode = LAYER_MODES[view.cursorCardLayer] ?? VISUALIZE_MODE.directLighting
      // Only the emission's layer reads the compressed store.
      const packed = mode === VISUALIZE_MODE.emissive && !!surface.atlases.compressed
      const made = tone ? previewOf(device, `${light}|${mode}|${packed}`) : undefined
      const draw = made?.draw.get()
      floats[0] = cursorOn ? cursor[0] : -1
      floats[1] = cursorOn ? cursor[1] : -1
      floats[2] = size[0]
      floats[3] = size[1]
      uints[4] = view.viewCards ? 1 : 0
      uints[5] = view.viewTiles ? 1 : 0
      uints[6] = tone?.baked ? 1 : 0
      uints[7] = draw ? 1 : 0
      query.send()
      const picked = pickGroup.over(
        device,
        kernels.layout,
        [
          { binding: B.query, resource: { buffer: query.buffer } },
          { binding: B.found, resource: { buffer: found } },
          { binding: B.view, resource: { buffer: deferred.uniform } },
          { binding: B.params, resource: { buffer: context.params } },
          { binding: B.context, resource: { buffer: context.context } },
          { binding: B.lines, resource: { buffer: lines.lines } },
          { binding: B.count, resource: { buffer: lines.count } },
          ...surfaceHitEntries(cursorCardHit(), reads.field, reads.hit),
        ],
        LABEL,
      )
      if (cursorOn) emptied = false
      else if (!emptied) {
        device.queue.writeBuffer(found, 0, NO_CARD)
        emptied = true
      }
      const pass = encoder.beginComputePass({ label: LABEL })
      pass.setBindGroup(0, picked)
      if (cursorOn) {
        pass.setPipeline(kernels.stages.pipelineOf('debugCursorCard'))
        pass.dispatchWorkgroups(1)
      }
      pass.setPipeline(kernels.stages.pipelineOf('debugCardOutlines'))
      pass.dispatchWorkgroups(
        ceilDiv(updateTilesOf(surface.settings, surface.atlases.side).direct, WORKGROUP),
      )
      pass.end()
      if (made && draw && tone)
        preview(encoder, target, size, made, draw, cursorCardPreviewHit(mode, packed), tone, reads)
      return true
    },
    dispose() {
      query.buffer.destroy()
      found.destroy()
    },
  }
}

/** The card view's state (`createCursorCard`). */
export type CursorCard = ReturnType<typeof createCursorCard>
