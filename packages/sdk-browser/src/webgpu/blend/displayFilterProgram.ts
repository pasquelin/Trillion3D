import { DISPLAY_FORMAT } from '../../scene/surfaceBuffer.ts';
import { ADD_EQUATIONS, TINT_EQUATIONS } from './equations.ts';

/** The composed image times the tint, plus the added value; on the capture target, and the canvas
 *  too when presented (an output without a target is dropped). The layers, at the frame's size or resolved to the display's, are
 *  sampled at the display pixel's place `uv`, the full-screen triangle's. */
export const DISPLAY_FILTER_SHADER = `
@group(0) @binding(0) var tintMap:texture_2d<f32>;
@group(0) @binding(1) var addMap:texture_2d<f32>;
@group(0) @binding(2) var layerSampler:sampler;
@group(0) @binding(3) var<uniform> drawn:vec4f;
struct Screen{@builtin(position) position:vec4f,@location(0) uv:vec2f,}
@vertex fn screen(@builtin(vertex_index) i:u32)->Screen{let c=vec2f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1));return Screen(vec4f(c,0.0,1.0),(vec2f(0.5,-0.5)*c+0.5)*drawn.xy);}
struct Both{@location(0) capture:vec4f,@location(1) canvas:vec4f,}
fn layer(map:texture_2d<f32>,uv:vec2f)->Both{let v=vec4f(textureSampleLevel(map,layerSampler,uv,0.0).rgb,1.0);return Both(v,v);}
@fragment fn tint(s:Screen)->Both{return layer(tintMap,s.uv);}
@fragment fn add(s:Screen)->Both{return layer(addMap,s.uv);}`;

/** The program of one device, made by its first image with display layers, kept across sizes. */
const programs = new WeakMap<GPUDevice, ReturnType<typeof createProgram>>();
function createProgram(device: GPUDevice) {
  const module = device.createShaderModule({ label: 'DISPLAY', code: DISPLAY_FILTER_SHADER });
  const texture = (binding: number): GPUBindGroupLayoutEntry => ({
    binding,
    visibility: GPUShaderStage.FRAGMENT,
    texture: { sampleType: 'float' },
  });
  const sampler = { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} };
  const drawn = { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: {} };
  const layout = device.createBindGroupLayout({
    entries: [texture(0), texture(1), sampler, drawn],
  });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  // The display value times the tint, then plus the added value, as the witness's canvas blends.
  const pipeline = (entryPoint: string, blend: GPUBlendState, formats: GPUTextureFormat[]) =>
    device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'screen' },
      fragment: { module, entryPoint, targets: formats.map((format) => ({ format, blend })) },
      primitive: { topology: 'triangle-list' },
    });
  const both: GPUTextureFormat[] = [DISPLAY_FORMAT, 'bgra8unorm'];
  const [tint, add] = [TINT_EQUATIONS.multiply!, ADD_EQUATIONS.additive!];
  return {
    layout,
    sampler: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }),
    mask: device.createBindGroupLayout({ entries: [texture(0)] }),
    draw: [pipeline('tint', tint, [DISPLAY_FORMAT]), pipeline('add', add, [DISPLAY_FORMAT])],
    present: [pipeline('tint', tint, both), pipeline('add', add, both)],
  };
}

export const programOf = (device: GPUDevice) =>
  programs.get(device) ?? programs.set(device, createProgram(device)).get(device)!;
