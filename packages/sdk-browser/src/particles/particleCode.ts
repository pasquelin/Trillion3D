// The particles' code, a family on demand (`../host/families.ts`, #1353): their step and draw, one
// module so that the CDN bundle makes one chunk of it.
export { createWebgpuParticles } from '../webgpu/particles/webgpuParticles.ts'
