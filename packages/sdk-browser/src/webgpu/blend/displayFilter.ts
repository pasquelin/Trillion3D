import { FULLSCREEN_VERTEX, SRGB_WGSL } from '../../lighting/deferred/shaders.ts';
import { TONE_MAPPING_WGSL } from '../../lighting/toneMappingWgsl.ts';
import { DISPLAY_FORMAT } from '../../scene/surfaceBuffer.ts';
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';
import { ADD_EQUATIONS, TINT_EQUATIONS } from './equations.ts';

/**
 * The display layers (#558): the witness, three@0.174, blends on its canvas, which holds display
 * values — after the tone curve. ACES mixes the channels, so a multiply or subtractive equation
 * on the lit target, in linear light, gives another colour (a red subtractive disc over paper kept
 * R = 132 where the witness shows 0). In an image whose blends hold such a surface, a mask pass
 * first marks the pixels those surfaces cover (`MASK_FORMAT`). There, every transparent layer —
 * blends in paint order, then particles and water — leaves the lit target alone and maps two
 * display targets instead, the tint `t` and the added value `a` (`TINT_EQUATIONS`,
 * `ADD_EQUATIONS`); the image shows `c·t + a` over the composed opaque value `c`, which is what
 * the witness's canvas holds, layer by layer. Elsewhere the lit target draws as before, and
 * `t = 1`, `a = 0`. The temporal pass resolves both beside the colour. An image without such a
 * surface allocates, binds and draws none of it.
 */

/** Eight bits of display value per channel, as the witness's canvas. */
export const FILTER_FORMAT: GPUTextureFormat = 'rgba8unorm';
/** One where a filtering surface covers the pixel. */
export const MASK_FORMAT: GPUTextureFormat = 'r8unorm';

/** The tint's and added value's targets of a pass drawing a layer of `mode`. */
export const displayTargets = (mode: Blending): GPUColorTargetState[] => [
  { format: FILTER_FORMAT, blend: TINT_EQUATIONS[mode] },
  { format: FILTER_FORMAT, blend: ADD_EQUATIONS[mode] },
];

/** Where a layer's colour `rgb` goes: `DISPLAY_ROUTE` 1 (normal, additive) sends it to the
 *  display layers where `masked`, else to the lit target (`keep`); 2 (multiply, subtractive)
 *  always; 0 leaves the layers at `(1, 0)` and shows nothing. What the layers take is its display
 *  value `shown`, the composition's chain: exposure, curve unless unlit, sRGB. */
export const DISPLAY_ROUTE_WGSL = `${TONE_MAPPING_WGSL}${SRGB_WGSL}
override DISPLAY_ROUTE:u32=0u;
struct Route{keep:f32,tint:vec4f,add:vec4f,}
fn displayRoute(rgb:vec3f,exposure:f32,curve:u32,unlit:bool,alpha:f32,masked:f32)->Route{
 if(DISPLAY_ROUTE==0u){return Route(1.0,vec4f(1.0),vec4f(0.0));}
 let shown=linearToSrgb(select(toneMap(rgb*exposure,curve),rgb,unlit));
 if(DISPLAY_ROUTE==1u){let a=alpha*masked;return Route(1.0-masked,vec4f(0.0,0.0,0.0,a),vec4f(shown*a,a));}
 return Route(1.0,vec4f(shown,1.0),vec4f(shown,1.0));
}`;

/** The mask, read at a fragment's pixel, in bind group `group`. */
export const displayMaskWgsl = (group: number) => `
@group(${group}) @binding(0) var displayMask:texture_2d<f32>;
fn maskAt(pixel:vec4f)->f32{return textureLoad(displayMask,vec2i(pixel.xy),0).r;}`;

/** The composed image times the tint, plus the added value; on the capture target and the canvas
 *  at once when presented. */
export const DISPLAY_FILTER_SHADER = `${FULLSCREEN_VERTEX}
@group(0) @binding(0) var tintMap:texture_2d<f32>;
@group(0) @binding(1) var addMap:texture_2d<f32>;
fn layer(map:texture_2d<f32>,pixel:vec4f)->vec4f{return vec4f(textureLoad(map,vec2i(pixel.xy),0).rgb,1.0);}
struct Both{@location(0) capture:vec4f,@location(1) canvas:vec4f,}
@fragment fn tint(@builtin(position) p:vec4f)->@location(0) vec4f{return layer(tintMap,p);}
@fragment fn add(@builtin(position) p:vec4f)->@location(0) vec4f{return layer(addMap,p);}
@fragment fn tintBoth(@builtin(position) p:vec4f)->Both{let v=layer(tintMap,p);return Both(v,v);}
@fragment fn addBoth(@builtin(position) p:vec4f)->Both{let v=layer(addMap,p);return Both(v,v);}`;

/** The program of one device, made by its first image with display layers, kept across sizes. */
const programs = new WeakMap<GPUDevice, ReturnType<typeof createProgram>>();
function createProgram(device: GPUDevice) {
  const module = device.createShaderModule({ label: 'DISPLAY', code: DISPLAY_FILTER_SHADER });
  const texture = (binding: number): GPUBindGroupLayoutEntry => ({
    binding,
    visibility: GPUShaderStage.FRAGMENT,
    texture: { sampleType: 'float' },
  });
  const layout = device.createBindGroupLayout({ entries: [texture(0), texture(1)] });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  // The display value times the tint, then plus the added value, as the witness's canvas blends.
  const pipeline = (entryPoint: string, blend: GPUBlendState, formats: GPUTextureFormat[]) =>
    device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'fullscreen' },
      fragment: { module, entryPoint, targets: formats.map((format) => ({ format, blend })) },
      primitive: { topology: 'triangle-list' },
    });
  const both: GPUTextureFormat[] = [DISPLAY_FORMAT, 'bgra8unorm'];
  const [tint, add] = [TINT_EQUATIONS.multiply!, ADD_EQUATIONS.additive!];
  return {
    layout,
    mask: device.createBindGroupLayout({ entries: [texture(0)] }),
    draw: [pipeline('tint', tint, [DISPLAY_FORMAT]), pipeline('add', add, [DISPLAY_FORMAT])],
    present: [pipeline('tintBoth', tint, both), pipeline('addBoth', add, both)],
  };
}

const programOf = (device: GPUDevice) =>
  programs.get(device) ?? programs.set(device, createProgram(device)).get(device)!;

/** The layout of the mask's bind group, the same for every pass that reads it. */
export const displayMaskLayout = (device: GPUDevice) => programOf(device).mask;

const load = (view: GPUTextureView) => ({ view, loadOp: 'load', storeOp: 'store' }) as const;
const clear = (view: GPUTextureView, white = false): GPURenderPassColorAttachment => ({
  ...load(view),
  loadOp: 'clear',
  clearValue: white ? [1, 1, 1, 1] : [0, 0, 0, 0],
});

/** The display layers of one image size: the tint, the added value and the mask, cleared by the
 *  first pass of the image that writes each, and what composes them. */
export function createDisplayFilter(device: GPUDevice, width: number, height: number) {
  const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
  const textures = [FILTER_FORMAT, FILTER_FORMAT, MASK_FORMAT].map((format, i) =>
    device.createTexture({
      label: `Trillion3D display ${['tint', 'added value', 'mask'][i]}`,
      size: { width, height },
      format,
      usage,
    }),
  );
  const [tint, add, mask] = textures.map((texture) => texture.createView());
  const views = [tint, add] as const;
  const { layout, mask: maskLayout, draw, present } = programOf(device);
  // The raw layers, or either temporal history: one group each, kept as long as its tint view.
  const groups = new WeakMap<GPUTextureView, GPUBindGroup>();
  return {
    views,
    width,
    height,
    bytes: width * height * 9,
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
      this.active = true;
      this.written = this.masked = false;
    },
    /** The tint's and added value's attachments: the first pass of the image clears them. */
    attachments(): GPURenderPassColorAttachment[] {
      const first = !this.written;
      this.written = true;
      return first ? [clear(tint, true), clear(add)] : views.map(load);
    },
    /** The mask pass's attachment, cleared. */
    maskAttachment(): GPURenderPassColorAttachment {
      this.masked = true;
      return clear(mask);
    },
    /** Composes `target`, and the canvas `presentation`, with the layers `source`. */
    apply(
      encoder: GPUCommandEncoder,
      source: readonly [GPUTextureView, GPUTextureView],
      target: GPUTextureView,
      presentation?: GPUTextureView,
    ) {
      let group = groups.get(source[0]);
      if (!group) {
        const entries = source.map((resource, binding) => ({ binding, resource }));
        groups.set(source[0], (group = device.createBindGroup({ layout, entries })));
      }
      const pass = encoder.beginRenderPass({
        label: 'Trillion3D display filter',
        colorAttachments: presentation ? [load(target), load(presentation)] : [load(target)],
      });
      pass.setBindGroup(0, group);
      for (const pipeline of presentation ? present : draw) {
        pass.setPipeline(pipeline);
        pass.draw(3);
      }
      pass.end();
    },
    dispose: () => textures.forEach((texture) => texture.destroy()),
  };
}

export type DisplayFilter = ReturnType<typeof createDisplayFilter>;

/** The layers a blend pass of the open image wrote: a diagnostic image keeps the last `written`. */
export const writtenFilter = (filter: DisplayFilter | undefined) =>
  filter?.active && filter.written ? filter.views : undefined;

/** The open image's layers where its mask pass ran: what particles and water route through. */
export const routedFilter = (filter: DisplayFilter | undefined) =>
  filter?.active && filter.masked ? filter : undefined;
