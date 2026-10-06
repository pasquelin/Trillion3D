import { SRGB_ENCODE_WGSL } from '../../texture/srgbEncode.ts'
import { TONE_MAPPING_WGSL } from '../../lighting/toneMappingWgsl.ts'
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'
import { ADD_EQUATIONS, TINT_EQUATIONS } from './equations.ts'
import { programOf } from './displayFilterProgram.ts'
import { textureBytesOf } from '../../gpu/core/textureBytes.ts'

/**
 * The display layers: the reference display multiplies and subtracts on a canvas of
 * display values, after the tone curve, which mixes the channels. In an image whose blends hold
 * such a surface, a mask pass marks the pixels it covers (`MASK_FORMAT`); there every transparent
 * layer — blends, particles, water — maps the tint `t` and the added value `a` instead of the lit
 * target (`TINT_EQUATIONS`, `ADD_EQUATIONS`), and the image shows `c·t + a` over the composed `c`.
 * Elsewhere `t = 1`, `a = 0`. Any other image allocates, binds and draws none of it.
 */

/** Eight bits of display value per channel, as a display canvas. */
export const FILTER_FORMAT: GPUTextureFormat = 'rgba8unorm'
/** One where a filtering surface covers the pixel. */
export const MASK_FORMAT: GPUTextureFormat = 'r8unorm'
/** Bytes per pixel of one texel of `format`, as the device ledger counts it. */
export const texelBytes = (format: GPUTextureFormat) => textureBytesOf({ size: [1, 1], format })!
/** Bytes per pixel of the display layers (`createDisplayFilter`): the tint and the added value in
 *  `FILTER_FORMAT`, and the mask. */
export const DISPLAY_LAYER_BYTES_PER_PIXEL = 2 * texelBytes(FILTER_FORMAT) + texelBytes(MASK_FORMAT)

/** The tint's and added value's targets of a pass drawing a layer of `mode`. */
export const displayTargets = (mode: Blending): GPUColorTargetState[] => [
  { format: FILTER_FORMAT, blend: TINT_EQUATIONS[mode] },
  { format: FILTER_FORMAT, blend: ADD_EQUATIONS[mode] },
]

/** Where a layer's colour `rgb` goes: `DISPLAY_ROUTE` 1 (normal, additive) sends it to the
 *  display layers where `masked`, else to the lit target (`keep`); 2 (multiply, subtractive)
 *  always; 0 leaves the layers at `(1, 0)` and shows nothing. What the layers take is its display
 *  value `shown`, the composition's chain: exposure, curve unless unlit, sRGB. */
export const DISPLAY_ROUTE_WGSL = `${TONE_MAPPING_WGSL}${SRGB_ENCODE_WGSL}
override DISPLAY_ROUTE:u32=0u;
struct Route{keep:f32,tint:vec4f,add:vec4f,}
fn displayRoute(rgb:vec3f,exposure:f32,curve:u32,unlit:bool,alpha:f32,masked:f32)->Route{
 if(DISPLAY_ROUTE==0u){return Route(1.0,vec4f(1.0),vec4f(0.0));}
 let shown=linearToSrgb(select(toneMap(rgb*exposure,curve),rgb,unlit));
 if(DISPLAY_ROUTE==1u){let a=alpha*masked;return Route(1.0-masked,vec4f(0.0,0.0,0.0,a),vec4f(shown*a,a));}
 return Route(1.0,vec4f(shown,1.0),vec4f(shown,1.0));
}`

/** The mask, read at a fragment's pixel, in bind group `group`. */
export const displayMaskWgsl = (group: number) => `
@group(${group}) @binding(0) var displayMask:texture_2d<f32>;
fn maskAt(pixel:vec4f)->f32{return textureLoad(displayMask,vec2i(pixel.xy),0).r;}`

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
  const { layout, sampler, mask: maskLayout, draw, present } = programOf(device)
  // The raw layers, or either temporal history: one group each, kept as long as its tint view.
  const groups = new WeakMap<GPUTextureView, GPUBindGroup>()
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
      layout: maskLayout,
      entries: [{ binding: 0, resource: mask }],
    }),
    /** Set from `open` to the composition: the transparent passes attach the layers meanwhile. */
    active: false,
    /** A blend pass of this image wrote the layers: before one does, they are `(1, 0)`. */
    written: false,
    /** The mask pass of this image ran: particles and water route through it. */
    masked: false,
    open() {
      this.active = true
      this.written = this.masked = false
    },
    /** The tint's and added value's attachments: the first pass of the image clears them. */
    attachments(): GPURenderPassColorAttachment[] {
      const first = !this.written
      this.written = true
      return first ? [clear(tint, true), clear(add)] : views.map(load)
    },
    /** The mask pass's attachment, cleared. */
    maskAttachment(): GPURenderPassColorAttachment {
      this.masked = true
      return clear(mask)
    },
    /** Composes `target`, and the canvas `presentation`, with the layers `source`, of which the
     *  image covers the top-left `x` by `y` share: the whole of the temporal ones. */
    apply(
      encoder: GPUCommandEncoder,
      source: readonly [GPUTextureView, GPUTextureView],
      target: GPUTextureView,
      presentation?: GPUTextureView,
      x = 1,
      y = 1,
    ) {
      // Compared as stored, a 32-bit float: a ratio that holds is not written again.
      if (share[0] !== Math.fround(x) || share[1] !== Math.fround(y)) {
        ;[share[0], share[1]] = [x, y]
        device.queue.writeBuffer(drawn, 0, share)
      }
      let group = groups.get(source[0])
      if (!group) {
        const resources = [...source, sampler, { buffer: drawn }]
        const entries = resources.map((resource, binding) => ({ binding, resource }))
        groups.set(source[0], (group = device.createBindGroup({ layout, entries })))
      }
      const pass = encoder.beginRenderPass({
        label: 'Trillion3D display filter',
        colorAttachments: presentation ? [load(target), load(presentation)] : [load(target)],
      })
      pass.setBindGroup(0, group)
      for (const pipeline of presentation ? present : draw) {
        pass.setPipeline(pipeline.get())
        pass.draw(3)
      }
      pass.end()
    },
    dispose() {
      for (const texture of textures) texture.destroy()
      drawn.destroy()
    },
  }
}

export type DisplayFilter = ReturnType<typeof createDisplayFilter>

/** The layers a blend pass of the open image wrote: a diagnostic image keeps the last `written`. */
export const writtenFilter = (filter: DisplayFilter | undefined) =>
  filter?.active && filter.written ? filter.views : undefined

/** The open image's layers where its mask pass ran: what particles and water route through. */
export const routedFilter = (filter: DisplayFilter | undefined) =>
  filter?.active && filter.masked ? filter : undefined
