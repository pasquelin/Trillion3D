// The WebGPU impostor draw's code, a family on demand (`../../host/families.ts`, #1335): the
// image's card plan, the card pipelines and atlas feed, and their encodes, one module so that the
// CDN bundle makes one chunk of it. The core asks it through `code.ts` only for a cache with baked
// impostors; until it lands, every root keeps its clusters.
export { planWebgpuImpostors } from './frame.ts';
export {
  drawImpostorVisibility,
  encodeImpostorCards,
  encodeImpostorVisibilityPass,
} from './encode.ts';
