import { TONE_MAPPING_RANK } from '../../../../sdk-core/src/scene/core/environment.ts'
import { linearToSrgb } from '../../../../math/src/wgsl/color.ts'
import { TONE_CHAIN_WGSL } from '../../lighting/toneBakeWgsl.ts'
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'
import { ADD_EQUATIONS, TINT_EQUATIONS } from '../equations.ts'
import { programOf } from './displayFilterProgram.ts'
import { chainReady } from '../../lighting/deferred/fullscreen.ts'
import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { DISPLAY_FILTER_PASS } from '../../diagnostic/stage/passLabels.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'

/**
 * The display layers: the reference display multiplies and subtracts on a canvas of
 * display values, after the tone curve, which mixes the channels. In an image whose blends hold
 * such a surface, a mask pass marks the pixels it covers (`MASK_FORMAT`); there every transparent
 * layer — blends, particles, transmissive layers — maps the tint `t` and the added value `a` instead of the lit
 * target (`TINT_EQUATIONS`, `ADD_EQUATIONS`), and the image shows `c·t + a` over the composed `c`.
 * Elsewhere `t = 1`, `a = 0`. Any other image allocates, binds and draws none of it.
 */

/** Eight bits of display value per channel, as a display canvas. */
export const FILTER_FORMAT: GPUTextureFormat = 'rgba8unorm'
/** One where a filtering surface covers the pixel. */
export const MASK_FORMAT: GPUTextureFormat = 'r8unorm'
/** Bytes per pixel of the display layers (`createDisplayFilter`): the tint and the added value in
 *  `FILTER_FORMAT`, and the mask. */
export const DISPLAY_LAYER_BYTES_PER_PIXEL =
  2 * texelBytesOf(FILTER_FORMAT) + texelBytesOf(MASK_FORMAT)

/** The tint's and added value's targets of a pass drawing a layer of `mode`. */
export const displayTargets = (mode: Blending): GPUColorTargetState[] => [
  { format: FILTER_FORMAT, blend: TINT_EQUATIONS[mode] },
  { format: FILTER_FORMAT, blend: ADD_EQUATIONS[mode] },
]

/** Where a layer's colour `rgb` goes: `DISPLAY_ROUTE` 1 (normal, additive) sends it to the
 *  display layers where `masked`, else to the lit target (`keep`); 2 (multiply, subtractive)
 *  always; 0 leaves the layers at `(1, 0)` and shows nothing. What the layers take is its display
 *  value `shown`, the composition's chain: exposure, the table's colours unless unlit — the
 *  baking's chain, run on the copy of its words `tone` that the view carries: the white balance, the
 *  grade, the curve, the transfer, as the table gives them, no texture read —, sRGB where unlit. */
export const DISPLAY_ROUTE_WGSL = wgslBlock(
  'DISPLAY_ROUTE_WGSL',
  [TONE_CHAIN_WGSL, linearToSrgb],
  `override DISPLAY_ROUTE:u32=0u;
struct Route{keep:f32,tint:vec4f,add:vec4f,}
fn layerShown(tone:Bake,exposed:vec3f,curve:u32)->vec3f{
 if(curve==${TONE_MAPPING_RANK.none}u){return linearToSrgb(exposed);}
 return displayLight(tone,exposed)*tone.device.w;
}
fn displayRoute(rgb:vec3f,exposure:f32,curve:u32,unlit:bool,alpha:f32,masked:f32,tone:Bake)->Route{
 if(DISPLAY_ROUTE==0u){return Route(1.0,vec4f(1.0),vec4f(0.0));}
 let shown=layerShown(tone,select(rgb*exposure,rgb,unlit),select(curve,${TONE_MAPPING_RANK.none}u,unlit));
 if(DISPLAY_ROUTE==1u){let a=alpha*masked;return Route(1.0-masked,vec4f(0.0,0.0,0.0,a),vec4f(shown*a,a));}
 return Route(1.0,vec4f(shown,1.0),vec4f(shown,1.0));
}`,
)

/** The mask's bind group in the blend runs: after their group 0 and the reflection group. */
export const DISPLAY_MASK_GROUP = 2

/** The mask, read at a fragment's pixel, in bind group `group`. */
export const displayMaskWgsl = (group: number) =>
  wgslBlock(
    `displayMaskWgsl(${group})`,
    [],
    `
@group(${group}) @binding(0) var displayMask:texture_2d<f32>;
fn maskAt(pixel:vec4f)->f32{return textureLoad(displayMask,vec2i(pixel.xy),0).r;}`,
  )

/** The layout of the mask's bind group, the same for every pass that reads it. */
export const displayMaskLayout = (device: GPUDevice) => programOf(device).mask

const load = (view: GPUTextureView) => ({ view, loadOp: 'load', storeOp: 'store' }) as const
const clear = (view: GPUTextureView, white = false): GPURenderPassColorAttachment => ({
  ...load(view),
  loadOp: 'clear',
  clearValue: white ? [1, 1, 1, 1] : [0, 0, 0, 0],
})

/** The display layers of one image size: the tint, the added value and the mask, cleared by the
 *  first pass of the image that writes each, and what composes them. */
export function createDisplayFilter(device: GPUDevice, width: number, height: number) {
  const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
  const textures = [FILTER_FORMAT, FILTER_FORMAT, MASK_FORMAT].map((format, i) =>
    device.createTexture({
      label: `Trillion3D display ${['tint', 'added value', 'mask'][i]}`,
      size: { width, height },
      format,
      usage,
    }),
  )
  const [tint, add, mask] = textures.map((texture) => texture.createView())
  const views = [tint, add] as const
  // The layers' attachments, held: the first pass of an image clears them, the others load.
  const clearing = [clear(tint, true), clear(add)]
  const loading = views.map(load)
  const masking = clear(mask)
  const program = programOf(device)
  // The share of the layers the image covers: a frame drawn below its targets fills their top-left.
  const drawn = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const share = new Float32Array([1, 1, 0, 0])
  device.queue.writeBuffer(drawn, 0, share)
  return {
    views,
    width,
    height,
    bytes: width * height * DISPLAY_LAYER_BYTES_PER_PIXEL,
    maskGroup: device.createBindGroup({
      layout: program.mask,
      entries: sequentialEntries([mask]),
    }),
    /** Set from `open` to the composition: the transparent passes attach the layers meanwhile. */
    active: false,
    /** A blend pass of this image wrote the layers: before one does, they are `(1, 0)`. */
    written: false,
    /** The mask pass of this image ran: particles route through it. */
    masked: false,
    open() {
      this.active = true
      this.written = this.masked = false
    },
    /** The tint's and added value's attachments: the first pass of the image clears them. */
    attachments(): GPURenderPassColorAttachment[] {
      const first = !this.written
      this.written = true
      return first ? clearing : loading
    },
    /** The mask pass's attachment, cleared. */
    maskAttachment(): GPURenderPassColorAttachment {
      this.masked = true
      return masking
    },
    /** Composes the target with the layers (`displayApply`). */
    apply: displayApply(device, program, drawn, share),
    dispose() {
      // This image's commands may still name them: retired, destroyed after the frame's submit.
      for (const texture of textures) retire(device, texture)
      retire(device, drawn)
    },
  }
}

/** The display filter's `apply`: composes `target`, and the canvas `presentation`, with the layers
 *  `source`, of which the image covers the top-left `x` by `y` share, written into `drawn` through
 *  `share`: the whole of the temporal ones. */
function displayApply(
  device: GPUDevice,
  { layout, sampler, draw, present }: ReturnType<typeof programOf>,
  drawn: GPUBuffer,
  share: Float32Array<ArrayBuffer>,
) {
  // The raw layers, or either temporal history: three held, a group each (`bindIdentity.ts`).
  const identity = createWebgpuBindIdentity(3),
    groups: GPUBindGroup[] = []
  // The pass over the target alone or with the canvas beside it, its attachments rewritten in place.
  const onTarget = { loadOp: 'load', storeOp: 'store' } as GPURenderPassColorAttachment
  const onCanvas = { loadOp: 'load', storeOp: 'store' } as GPURenderPassColorAttachment
  const alone = [onTarget],
    both = [onTarget, onCanvas]
  const descriptor: GPURenderPassDescriptor = {
    label: DISPLAY_FILTER_PASS,
    colorAttachments: alone,
  }
  return (
    encoder: GPUCommandEncoder,
    source: readonly [GPUTextureView, GPUTextureView],
    target: GPUTextureView,
    presentation?: GPUTextureView,
    x = 1,
    y = 1,
  ) => {
    // The tint then the added value are one composition: none is drawn, and no share written,
    // while one of the pair compiles (`prepareDisplayProgram`, asked once layers are reached).
    const pipelines = presentation ? present : draw
    if (!chainReady(...pipelines)) return false
    // Compared as stored, a 32-bit float: a ratio that holds is not written again.
    if (share[0] !== Math.fround(x) || share[1] !== Math.fround(y)) {
      ;[share[0], share[1]] = [x, y]
      device.queue.writeBuffer(drawn, 0, share)
    }
    identity.next[0] = source[0]
    identity.next[1] = source[1]
    if (identity.moved())
      groups[identity.slot] = device.createBindGroup({
        layout,
        entries: sequentialEntries([...source, sampler, { buffer: drawn }]),
      })
    const group = groups[identity.slot]
    onTarget.view = target
    if (presentation) onCanvas.view = presentation
    descriptor.colorAttachments = presentation ? both : alone
    const pass = encoder.beginRenderPass(descriptor)
    pass.setBindGroup(0, group)
    for (const pipeline of pipelines) {
      pass.setPipeline(pipeline.get()!)
      pass.draw(3)
    }
    pass.end()
    return true
  }
}

export type DisplayFilter = ReturnType<typeof createDisplayFilter>

/** The layers a blend pass of the open image wrote: a diagnostic image keeps the last `written`. */
export const writtenFilter = (filter: DisplayFilter | undefined) =>
  filter?.active && filter.written ? filter.views : undefined

/** The open image's layers where its mask pass ran: what particles route through. */
export const routedFilter = (filter: DisplayFilter | undefined) =>
  filter?.active && filter.masked ? filter : undefined
