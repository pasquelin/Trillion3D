import { FULLSCREEN_VERTEX, SRGB_WGSL } from '../../lighting/deferred/shaders.ts';
import { TONE_MAPPING_WGSL } from '../../lighting/toneMappingWgsl.ts';
import { DISPLAY_FORMAT } from '../../scene/surfaceBuffer.ts';
import { FILTER_EQUATIONS } from './equations.ts';

/**
 * The display filter (#558): the witness, three@0.174, multiplies and subtracts on its canvas,
 * which holds display values — after the tone curve. ACES mixes the channels, so the same
 * equation on the lit target, in linear light, gives another colour (a red subtractive disc over
 * paper kept R = 132 where the witness shows 0). In an image whose blends hold a multiply or
 * subtractive surface, those surfaces leave the lit target untouched (`FILTERED_EQUATIONS`) and
 * blend their display colour into this white target instead (`FILTER_EQUATIONS`); the temporal
 * pass resolves it beside the colour, and the composed image is multiplied by it. An image
 * without such a surface allocates, binds and draws none of it.
 */

/** Eight bits of display value per channel, as the witness's canvas. */
export const FILTER_FORMAT: GPUTextureFormat = 'rgba8unorm';

/** What a blend writes in the filter: a filtering mode's pipeline (`FILTERS_DISPLAY`) its colour
 *  as the composition shows it — exposed, through the scene's curve unless the view is unlit,
 *  sRGB-encoded —, every other white at its alpha. */
export const DISPLAY_FILTER_WGSL = `${TONE_MAPPING_WGSL}${SRGB_WGSL}
override FILTERS_DISPLAY:bool=false;
fn displayFilter(rgb:vec3f,alpha:f32,unlit:bool)->vec4f{
 if(!FILTERS_DISPLAY){return vec4f(1.0,1.0,1.0,alpha);}
 return vec4f(linearToSrgb(select(toneMap(rgb*uni.exposure,uni.toneCurve),rgb,unlit)),1.0);
}`;

/** The composed image times the filter, on the capture target and the canvas at once. */
export const DISPLAY_FILTER_SHADER = `${FULLSCREEN_VERTEX}
@group(0) @binding(0) var filterMap:texture_2d<f32>;
fn filterAt(pixel:vec4f)->vec4f{return vec4f(textureLoad(filterMap,vec2i(pixel.xy),0).rgb,1.0);}
@fragment fn apply(@builtin(position) pixel:vec4f)->@location(0) vec4f{return filterAt(pixel);}
struct Both{@location(0) capture:vec4f,@location(1) canvas:vec4f,}
@fragment fn applyPresent(@builtin(position) pixel:vec4f)->Both{let f=filterAt(pixel);return Both(f,f);}`;

/** The multiply program of one device, made by its first filter and kept across sizes. */
const programs = new WeakMap<GPUDevice, ReturnType<typeof createProgram>>();
function createProgram(device: GPUDevice) {
  const module = device.createShaderModule({
    label: 'DISPLAY_FILTER_SHADER',
    code: DISPLAY_FILTER_SHADER,
  });
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  // The display value times the filter's, as the witness's canvas multiplies.
  const pipeline = (entryPoint: string, formats: GPUTextureFormat[]) =>
    device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'fullscreen' },
      fragment: {
        module,
        entryPoint,
        targets: formats.map((format) => ({ format, blend: FILTER_EQUATIONS.multiply })),
      },
      primitive: { topology: 'triangle-list' },
    });
  return {
    layout,
    draw: pipeline('apply', [DISPLAY_FORMAT]),
    present: pipeline('applyPresent', [DISPLAY_FORMAT, 'bgra8unorm']),
  };
}

const WHITE = [1, 1, 1, 1];

/** The filter of one image size: its target, cleared white by the first blend pass that writes
 *  it, and what multiplies it in. */
export function createDisplayFilter(device: GPUDevice, width: number, height: number) {
  const texture = device.createTexture({
    label: 'Trillion3D display filter',
    size: { width, height },
    format: FILTER_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const view = texture.createView();
  let program = programs.get(device);
  if (!program) programs.set(device, (program = createProgram(device)));
  const { layout, draw, present } = program;
  // The raw filter, or either temporal history: one group each, kept as long as the view.
  const groups = new WeakMap<GPUTextureView, GPUBindGroup>();
  return {
    view,
    width,
    height,
    bytes: width * height * 4,
    /** Set from `open` to the multiply: the blend pass attaches the filter meanwhile. */
    active: false,
    /** A blend pass of this image wrote the filter: before one does, it is all white. */
    written: false,
    open() {
      this.active = true;
      this.written = false;
    },
    /** The blend pass's attachment: the first of the image clears the filter white. */
    attachment(): GPURenderPassColorAttachment {
      const first = !this.written;
      this.written = true;
      return first
        ? { view, loadOp: 'clear', storeOp: 'store', clearValue: WHITE }
        : { view, loadOp: 'load', storeOp: 'store' };
    },
    /** Multiplies `target`, and the canvas `presentation`, by the filter `source`. */
    apply(
      encoder: GPUCommandEncoder,
      source: GPUTextureView,
      target: GPUTextureView,
      presentation?: GPUTextureView,
    ) {
      let group = groups.get(source);
      if (!group)
        groups.set(
          source,
          (group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: source }] })),
        );
      const load = (at: GPUTextureView) =>
        ({ view: at, loadOp: 'load', storeOp: 'store' }) as const;
      const pass = encoder.beginRenderPass({
        label: 'Trillion3D display filter',
        colorAttachments: presentation ? [load(target), load(presentation)] : [load(target)],
      });
      pass.setPipeline(presentation ? present : draw);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    },
    dispose: () => texture.destroy(),
  };
}

export type DisplayFilter = ReturnType<typeof createDisplayFilter>;
