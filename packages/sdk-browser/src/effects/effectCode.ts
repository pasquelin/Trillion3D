// The effect chain's code, a family on demand (`../host/families.ts`, #1353): the passes of both
// renderers, one module so that the CDN bundle makes one chunk of it.
export { createWebglEffects } from '../webgl/effects/webglEffects.ts';
export { createWebgpuEffects } from '../webgpu/effects/webgpuEffects.ts';
