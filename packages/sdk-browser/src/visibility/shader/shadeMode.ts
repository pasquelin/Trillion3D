import type { DiagnosticMode } from '../../../../sdk-core/src/index.ts'

/** `uni.mode` of the resolve, per diagnostic view (`./shadeWgsl.ts`); beauty is zero. */
export const SHADE_MODE: Partial<Record<DiagnosticMode, number>> = {
  wireframe: 1,
  clusters: 2,
  pages: 3,
  lod: 4,
  visibility: 5,
  'screen-error': 6,
  materials: 7,
}
