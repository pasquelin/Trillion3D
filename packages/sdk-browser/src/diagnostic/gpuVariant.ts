import type { DiagnosticDetail } from '../backend/types.ts';
import { DIAGNOSTIC_GPU_VARIANTS } from './gpuVariants.ts';

export type DiagnosticGpuVariant = (typeof DIAGNOSTIC_GPU_VARIANTS)[number];

/** Checks the requested variant and the detail under which it is allowed. Outside `trace`, refused. */
export function resolveDiagnosticGpuVariant(
  variant: string | undefined,
  detail: DiagnosticDetail | undefined,
): DiagnosticGpuVariant | undefined {
  if (variant === undefined) return undefined;
  if (!(DIAGNOSTIC_GPU_VARIANTS as readonly string[]).includes(variant))
    throw new Error(`DIAGNOSTIC_GPU_VARIANT_UNKNOWN: ${variant}`);
  if (detail !== 'trace') throw new Error('DIAGNOSTIC_GPU_VARIANT_REQUIRES_TRACE');
  return variant as DiagnosticGpuVariant;
}

/** The two diagnostic fragment stages, added to the blend module for these variants
 *  only: without a variant, production compiles exactly the previous module. */
export const DIAGNOSTIC_BLEND_WGSL = `
@fragment fn fsPlat()->BlendOut{return BlendOut(vec4f(0.5,0.5,0.5,0.5),0u,vec4f(0.0,0.0,0.0,0.5),vec4f(1.0),vec4f(0.0));}
@fragment fn fsJete()->BlendOut{discard;return BlendOut(vec4f(0.0),0u,vec4f(0.0),vec4f(1.0),vec4f(0.0));}`;

/** Fragment stage and write mask of a variant, for the blend pass. */
export function blendVariantPipeline(variant: DiagnosticGpuVariant | undefined) {
  switch (variant) {
    case 'blend-flat':
      return { entryPoint: 'fsPlat', writeMask: 0xf };
    case 'blend-vertices':
      return { entryPoint: 'fsJete', writeMask: 0xf };
    case 'blend-no-colour':
      return { entryPoint: 'fs', writeMask: 0 };
    case 'blend-overdraw':
      return { entryPoint: 'fsPlat', writeMask: 0 };
    default:
      return { entryPoint: 'fs', writeMask: 0xf };
  }
}

/** True when the variant counts blend fragments by occlusion query. */
export const countsBlendOverdraw = (variant?: DiagnosticGpuVariant) => variant === 'blend-overdraw';

/** True when the variant composes off-screen: the swap chain is not touched this frame. */
export const composesOffscreen = (variant?: DiagnosticGpuVariant) =>
  variant === 'present-offscreen';

/** What the variant has encoded twice in the cut: everything, its head only, or nothing. */
export const selectionRepeat = (variant?: DiagnosticGpuVariant) =>
  variant === 'selection-doubled' ? 'all' : variant === 'selection-head-doubled' ? 'head' : null;
