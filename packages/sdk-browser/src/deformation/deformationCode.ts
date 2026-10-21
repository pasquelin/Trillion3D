// WebGPU deformation's code, a family on demand (`../session/host/families.ts`): the compute stage that
// skins, morphs and moves `mesh.waves` and the bank pass that poses the animation banks' tracks
// before it (`compute.ts`, their WGSL), its per-image records and tracks (`webgpuFrame.ts`) and
// encoding, and the float-pool blocks' rows — one module, so that the CDN bundle makes one chunk of
// it. A session that deforms awaits it at prepare (`prepare.ts`). The records and tracks a session
// keeps (`session.ts`, `bankTracks.ts`) stay in the core.
export { createDeformationCompute } from './compute.ts'
export { updateWebgpuDeformation } from './webgpuFrame.ts'
export { encodeDeformation } from './encode.ts'
export { pooledDeformationRows } from './pooledRows.ts'
