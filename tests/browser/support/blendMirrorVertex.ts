import { createScreenReflection } from '../../../packages/sdk-browser/src/reflections/gpu.ts';
import { MODEL_SHIFT } from '../../../packages/sdk-browser/src/scene/surfaceModel.ts';

// An untextured metal plane, or a diffuse/toon plane with roughness 1 and a zero-green map.
// Flat model bits are the same ones the production vertex takes from the item's spare lane.
export const mirrorVertex = (rough: number, model: number) => `
@vertex fn mirrorVertex(@builtin(vertex_index) i:u32)->VSOut{
 var out:VSOut;
 let p=vec2f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1));
 out.position=vec4f(p,0.5,1.0);out.view=vec3f(p,0.0);
 out.normal=vec3f(0.0,0.0,1.0);out.color=vec4f(1.0);
 out.ids=vec3u(0u,${17 | (model << MODEL_SHIFT)}u,0u);
 out.pbr=vec4f(${model ? 1 : rough},${model ? 0 : 1},1.0,1.0);
 out.maps.x=${model ? 1 : 0}u;
 return out;
}`;

/** Disabled screen source keeps this proxy-specific shader proof independent of screen hits. */
export function proxyOnlyReflection(device: GPUDevice) {
  const depth = device.createTexture({
    size: [1, 1],
    format: 'depth32float',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });
  const reflection = createScreenReflection(device, 1, 1, depth.createView(), false);
  return {
    group: reflection.group,
    dispose() {
      reflection.dispose();
      depth.destroy();
    },
  };
}
