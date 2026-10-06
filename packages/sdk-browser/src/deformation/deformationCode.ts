// WebGPU deformation's code, a family on demand (`../host/families.ts`, #1353): the compute stage
// that skins, morphs and moves `mesh.waves` (`compute.ts`, its WGSL), its per-image records
// (`webgpuFrame.ts`) and encoding, and the whole copies' pool — one module, so that the CDN bundle
// makes one chunk of it. A session that deforms awaits it at prepare (`prepare.ts`). The records a
// session keeps (`session.ts`) and WebGL2's deformation, which its one cluster program compiles
// for every scene (`../webgl/cluster/shaders.ts`), stay in the core.
export { createDeformationCompute } from './compute.ts'
export { updateWebgpuDeformation } from './webgpuFrame.ts'
export { encodeDeformation } from './encode.ts'
export { wholeDeformationPool } from './wholePool.ts'
