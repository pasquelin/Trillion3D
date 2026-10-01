// The WebGPU impostor draw, a family on demand loaded through `code.ts` (#1335): its card plan, its
// pipelines and atlas feed and their encodes, one module the CDN bundle makes one chunk of.
export { planWebgpuImpostors } from './frame.ts';
export {
  drawImpostorVisibility,
  encodeImpostorCards,
  encodeImpostorVisibilityPass,
} from './encode.ts';
