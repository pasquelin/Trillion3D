import { FULLSCREEN_VERTEX } from '../lighting/deferred/shaders.ts';
import { taaReprojectWgsl } from '../taa/shaderWgsl.ts';
import { writeReprojection } from '../taa/view.ts';
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts';
import { PAGE_INFO_STRUCT_WGSL } from '../visibility/shader/pageWgsl.ts';
import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts';

export const REFLECTION_SOURCE_VIEW_BYTES = 176;

/**
 * The reflection source without a second lighting pass: the last image's lit colour, as the
 * reference's screen traces read it, brought to this image's pixels through the camera and the
 * placement motion (`taaReprojectWgsl`, the temporal pass's own). Alpha is 1 where the point was on
 * the last image, 0 where it was not (a first image, a point off the last one): a trace reaching
 * such a pixel misses and reads the fallback, never black.
 */
export const REFLECTION_SOURCE_WGSL = `
${FULLSCREEN_VERTEX}
${PAGE_INFO_STRUCT_WGSL}
struct ReflectionSourceView{prevViewProj:mat4x4f,invViewProj:mat4x4f,viewport:vec4f,params:vec4f,last:vec4f,}
@group(0) @binding(0) var lastImage:texture_2d<f32>;
@group(0) @binding(1) var lastSampler:sampler;
@group(0) @binding(2) var depth:texture_depth_2d;
@group(0) @binding(3) var ids:texture_2d<u32>;
@group(0) @binding(4) var<uniform> view:ReflectionSourceView;
@group(0) @binding(5) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(6) var<storage,read> motion:array<mat4x4f>;
${taaReprojectWgsl(false)}
@fragment fn reprojectReflectionSource(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let at=vec2i(pixel.xy);let z=textureLoad(depth,at,0);
 if(view.params.x==0.0||z==0.0){return vec4f(0.0);}
 let uv=previousUv(at,z,at);
 if(uv.z==0.0){return vec4f(0.0);}
 return vec4f(textureSampleLevel(lastImage,lastSampler,uv.xy*view.last.xy*view.last.zw,0.0).rgb,1.0);
}`;

export const reflectionSourceLayout = oncePerDevice((device) => {
  const visibility = GPUShaderStage.FRAGMENT;
  return device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility, texture: { sampleType: 'float' } },
      { binding: 1, visibility, sampler: { type: 'filtering' } },
      { binding: 2, visibility, texture: { sampleType: 'depth' } },
      { binding: 3, visibility, texture: { sampleType: 'uint' } },
      { binding: 4, visibility, buffer: { type: 'uniform' } },
      { binding: 5, visibility, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility, buffer: { type: 'read-only-storage' } },
    ],
  });
});

/** What the reprojection reads beside the depth: the last lit image, this image's identifiers,
 *  the page table and the placement motion, live only while the temporal pass writes it (the
 *  page table otherwise, bound and never read); `eye`, the render origin that motion is written at. */
export interface ReflectionSourceInputs {
  last: GPUTextureView;
  ids: GPUTextureView;
  pages: GPUBuffer;
  motion: GPUBuffer;
  eye: ArrayLike<number>;
}

/** The reprojection's uniform and bind group over targets of `width × height`. */
export function createReflectionSource(
  device: GPUDevice,
  width: number,
  height: number,
  depth: GPUTextureView,
) {
  const uniform = device.createBuffer({
    label: 'Trillion3D reflection source view',
    size: REFLECTION_SOURCE_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const packed = new Float32Array(REFLECTION_SOURCE_VIEW_BYTES / 4),
    last = new Float64Array(16),
    lastDrawn = [0, 0];
  const identity = createWebgpuBindIdentity();
  let drawnBefore = false,
    group: GPUBindGroup | undefined;
  return {
    /** The bind group of the last `update`, none unless it was given inputs. */
    get group() {
      return group;
    },
    /** This image's view and drawn size; each call is one lit image, the next one's source. */
    update(matrix: ArrayLike<number>, drawn: readonly number[], inputs?: ReflectionSourceInputs) {
      if (inputs) {
        const next = identity.next;
        next[0] = inputs.last;
        next[1] = inputs.ids;
        next[2] = inputs.pages;
        next[3] = inputs.motion;
        if (identity.moved() || !group)
          group = device.createBindGroup({
            layout: reflectionSourceLayout(device),
            entries: [
              { binding: 0, resource: inputs.last },
              { binding: 1, resource: sampler },
              { binding: 2, resource: depth },
              { binding: 3, resource: inputs.ids },
              { binding: 4, resource: { buffer: uniform } },
              { binding: 5, resource: { buffer: inputs.pages } },
              { binding: 6, resource: { buffer: inputs.motion } },
            ],
          });
        writeReprojection(packed, last, matrix, inputs.eye, drawn);
        packed[36] = drawnBefore ? 1 : 0;
        // The motion is live unless it is the page table (`liveMotion`).
        packed[38] = inputs.motion !== inputs.pages ? 1 : 0;
        packed[40] = lastDrawn[0];
        packed[41] = lastDrawn[1];
        packed[42] = 1 / width;
        packed[43] = 1 / height;
        device.queue.writeBuffer(uniform, 0, packed);
        // Without inputs no source is drawn (`encode.ts`): nothing reads the uniform.
      } else group = undefined;
      last.set(matrix);
      lastDrawn[0] = drawn[0];
      lastDrawn[1] = drawn[1];
      drawnBefore = true;
    },
    dispose() {
      uniform.destroy();
    },
  };
}
export type ReflectionSource = ReturnType<typeof createReflectionSource>;
