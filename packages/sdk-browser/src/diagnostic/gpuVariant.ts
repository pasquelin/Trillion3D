import type { DiagnosticDetail } from '../backend/types.ts';

/**
 * GPU DIAGNOSTIC variants. They exist only to split a duration: each one neutralises ONE
 * factor of the frame without touching the encoded commands — same passes, same draw calls,
 * same order, same sort — with three declared exceptions: the doubled cut re-encodes its
 * selection, `geometrie-une-passe` drops the second visibility pass, and `raster-calcul` and
 * `raster-hybride` hand all or part of the opaque geometry to the compute raster; their
 * durations do not subtract like the others. The rendered image therefore DIFFERS from the
 * production image by construction: none is an optimisation, none is measured in fidelity,
 * and no production path turns one on. The only way is `diagnosticGpuVariant` of
 * `openMeasuredWorld`, refused outside `diagnosticDetail: 'trace'`.
 */
export const DIAGNOSTIC_GPU_VARIANTS = [
  /** Blend fragment stage renders a constant colour: no texture, no lighting. */
  'transparents-plat',
  /** Fragment stage discards immediately: only vertices and rasterisation remain. */
  'transparents-sommets',
  /** Full fragment stage, with no colour write at all (mask at zero). */
  'transparents-sans-couleur',
  /** Constant fragments, with no write, counted by occlusion query: the overdraw rate. */
  'transparents-surdessin',
  /** Composition no longer writes the swap-chain view: off-screen presentation. */
  'presentation-hors-ecran',
  /** The whole cut is encoded TWICE. Each kernel restarts from the reset, so the final
   *  state and the image are those of a single run: the frame gap is the true cost of
   *  selection, waits between dispatches included, that no pass envelope reports. */
  'selection-doublee',
  /** The head of the cut — prepare, nodes, wanted clusters — encoded twice, also
   *  idempotent. By subtraction with the previous, the tail: escalations, mask, compaction. */
  'selection-tete-doublee',
  /** Visibility raster no longer applies the opacity mask: no atlas read, no discard. */
  'geometrie-plat',
  /** Visibility raster discards immediately: only vertices and triangles remain. */
  'geometrie-sommets',
  /** The second visibility pass is not encoded: occluders only. */
  'geometrie-une-passe',
  /** The compute raster draws the WHOLE opaque and masked cut, as b72278c6 did in
   *  production; without it, the hardware raster draws. Two sides that differ only by it
   *  give, at the same size, the envelope and the frame gap of compute against hardware. */
  'raster-calcul',
  /** The reference split: triangles of the raster's fine class — a box of three pixels
   *  of side at most — to the compute raster, all others to hardware. That is the production
   *  candidate; it only enters if the envelope says so. */
  'raster-hybride',
  /** Surface resolve reads nothing and returns a constant value. */
  'resolution-plate',
  /** Surface resolve reads only the visibility buffer, with no material and no atlas. */
  'resolution-identifiants',
] as const;

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
@fragment fn fsPlat()->BlendOut{return BlendOut(vec4f(0.5,0.5,0.5,0.5),0u);}
@fragment fn fsJete()->BlendOut{discard;return BlendOut(vec4f(0.0),0u);}`;

/** Fragment stage and write mask of a variant, for the blend pass. */
export function blendVariantPipeline(variant: DiagnosticGpuVariant | undefined) {
  switch (variant) {
    case 'transparents-plat':
      return { entryPoint: 'fsPlat', writeMask: 0xf };
    case 'transparents-sommets':
      return { entryPoint: 'fsJete', writeMask: 0xf };
    case 'transparents-sans-couleur':
      return { entryPoint: 'fs', writeMask: 0 };
    case 'transparents-surdessin':
      return { entryPoint: 'fsPlat', writeMask: 0 };
    default:
      return { entryPoint: 'fs', writeMask: 0xf };
  }
}

/** True when the variant counts blend fragments by occlusion query. */
export const countsBlendOverdraw = (variant?: DiagnosticGpuVariant) =>
  variant === 'transparents-surdessin';

/** True when the variant composes off-screen: the swap chain is not touched this frame. */
export const composesOffscreen = (variant?: DiagnosticGpuVariant) =>
  variant === 'presentation-hors-ecran';

/** What the variant has encoded twice in the cut: everything, its head only, or nothing. */
export const selectionRepeat = (variant?: DiagnosticGpuVariant) =>
  variant === 'selection-doublee' ? 'tout' : variant === 'selection-tete-doublee' ? 'tete' : null;
