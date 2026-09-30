// The fluids' renderer code, imported on first use (#1353): the water pass of a scene that
// transmits (`../webgpu/blend/pipelines.ts`) and the particle step of each renderer
// (`particleCode.ts`). One module, so that the CDN bundle makes one chunk of it
// (`scripts/bundle-fold.ts`), which a page with neither never downloads.
export { createWaterPass, waterWithoutFeedback } from '../webgpu/water/waterPass.ts';
export { WATER_SURFACE_WGSL } from '../webgpu/water/surfaceWgsl.ts';
export { createWebgpuParticles } from '../particles/webgpuParticles.ts';
export { createWebglParticles } from '../particles/webglParticles.ts';
