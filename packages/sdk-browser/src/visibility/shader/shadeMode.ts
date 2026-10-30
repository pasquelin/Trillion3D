import type { DiagnosticMode } from '../../../../sdk-core/src/runtime/diagnostics.ts'

/**
 * THE ONE TABLE OF THE DIAGNOSTIC VIEWS: each view's code — the resolve's `uni.mode`
 * (`./shadeWgsl.ts`), the transparent
 * pass's code bits (`DIAGNOSTIC_CODE_SHIFT`, `../../blend/uniforms.ts`), all painted by
 * `diagnosticColor` (`../../diagnostic/colors.ts`) — and the cluster word a transparent instance
 * reads for it (`../../blend/diagnostic.ts`): the cluster's hash, or its diagnostic word
 * (`pageDiagnosticWord`). Beauty is zero.
 */
export const DIAGNOSTIC_VIEWS = {
  wireframe: { code: 1 },
  clusters: { code: 2, reads: 'hash' },
  pages: { code: 3 },
  lod: { code: 4, reads: 'word' },
  visibility: { code: 5 },
  'screen-error': { code: 6, reads: 'word' },
  materials: { code: 7 },
  triangles: { code: 8, reads: 'hash' },
  hlod: { code: 9, reads: 'word' },
  xray: { code: 10 },
  voxels: { code: 11, reads: 'word' },
} as const satisfies Partial<Record<DiagnosticMode, { code: number; reads?: 'hash' | 'word' }>>

type View = { code: number; reads?: 'hash' | 'word' }
const viewOf = (mode: DiagnosticMode): View | undefined =>
  (DIAGNOSTIC_VIEWS as Partial<Record<DiagnosticMode, View>>)[mode]

/** The code of a diagnostic view (`DIAGNOSTIC_VIEWS`), zero for beauty and any view without one. */
export const diagnosticCode = (mode: DiagnosticMode) => viewOf(mode)?.code ?? 0

/** The cluster word a view reads, if any (`DIAGNOSTIC_VIEWS`). */
export const diagnosticReads = (mode: DiagnosticMode) => viewOf(mode)?.reads

/**
 * THE VIEWS OF THE LIT IMAGE: drawn through the normal pipeline — the resolve at code zero, the
 * lighting, the temporal pass — and shown by a step of it rather than painted by `diagnosticColor`.
 * `light` is the term the lighting program outputs in place of the lit surface (`view.views.x`,
 * `../../lighting/deferred/litSurfaceWgsl.ts`): 1 the reflection alone, 2 the shadowed lights'
 * visibility, 3 the lighting on a white surface; 0 the lit surface itself. `chain`, whether the
 * image keeps the rest of the beauty chain — effects, particles, display layers — which a view of
 * one lighting term leaves out, so that nothing but that term reaches the screen. `raw`, whether it
 * is shown in raw values, no display curve: a measure in grey. `taa`, what the temporal resolve
 * outputs in place of the accumulated colour (`view.params.w`, `../../post/taa/resolveWgsl.ts`): 1 the
 * image it receives, at the render pixel each display pixel falls in, 2 the shading rejection it
 * applies, 3 the history validity it holds after its update, 4 to 9 the analysis views — the
 * flicker measure, the shading rejection, the reprojection, the motion, the thin geometry, three
 * factors each in red, green and blue, and the responsiveness each pixel carries, as grey
 * (`FIRST_ANALYSIS_VIEW`, `../../post/taa/rejectionShared.ts`); 0 the accumulated colour itself.
 */
const LIT_VIEWS = {
  'frame-difference': { light: 0, chain: true },
  'no-temporal-aa': { light: 0, chain: true },
  'taa-input': { light: 0, chain: true, taa: 1 },
  'taa-rejection': { light: 0, chain: false, raw: true, taa: 2 },
  'taa-validity': { light: 0, chain: false, raw: true, taa: 3 },
  'taa-flicker': { light: 0, chain: false, raw: true, taa: 4 },
  'taa-shading': { light: 0, chain: false, raw: true, taa: 5 },
  'taa-reprojection': { light: 0, chain: false, raw: true, taa: 6 },
  'taa-motion': { light: 0, chain: false, raw: true, taa: 7 },
  'taa-thin': { light: 0, chain: false, raw: true, taa: 8 },
  'taa-material-history': { light: 0, chain: false, raw: true, taa: 9 },
  reflections: { light: 1, chain: false },
  shadows: { light: 2, chain: false, raw: true },
  lighting: { light: 3, chain: false },
  'hair-light-bounds': { light: 0, chain: true },
  'hair-deep-opacity-maps': { light: 0, chain: true },
  'hair-macro-group-screen-rect': { light: 0, chain: true },
  'hair-voxels-density': { light: 0, chain: true },
  'sampled-lights-overview': { light: 0, chain: true },
  'sampled-lights-shadow-casters': { light: 0, chain: true },
  'sampled-lights-shadow-caster-quality': { light: 0, chain: true },
  'sampled-lights-complexity-opaque': { light: 0, chain: true },
  'sampled-lights-complexity-front-layer': { light: 0, chain: true },
  'subsurface-profiles': { light: 0, chain: true },
  'virtual-shadow-map-shadow-casters': { light: 0, chain: true },
  'virtual-shadow-map-clipmap-virtual-space': { light: 0, chain: true },
  'virtual-shadow-map-shadow-factor': { light: 0, chain: true },
  'virtual-shadow-map-clipmap-or-mip': { light: 0, chain: true },
  'virtual-shadow-map-virtual-page': { light: 0, chain: true },
  'virtual-shadow-map-cached-page': { light: 0, chain: true },
  'virtual-shadow-map-ray-count': { light: 0, chain: true },
  'virtual-shadow-map-general-debug': { light: 0, chain: true },
  'virtual-shadow-map-dirty-page': { light: 0, chain: true },
  'virtual-shadow-map-gpu-invalidated-page': { light: 0, chain: true },
  'virtual-shadow-map-merged-page': { light: 0, chain: true },
  'virtual-shadow-map-overdraw': { light: 0, chain: true },
  'rect-light-atlas': { light: 0, chain: true },
  'light-profile-atlas': { light: 0, chain: true },
  'surface-cache-direct-stats': { light: 0, chain: true },
  'surface-cache-indirect-stats': { light: 0, chain: true },
  'surface-cache-direct-lighting-stats': { light: 0, chain: true },
  'surface-cache-scene-stats': { light: 0, chain: true },
  'surface-cache-primitive-groups': { light: 0, chain: true },
  'radiance-cache-stats': { light: 0, chain: true },
  'screen-probe-gather-debug': { light: 0, chain: true },
  'screen-probe-tile-stats': { light: 0, chain: true },
  'screen-probe-placement': { light: 0, chain: true },
  'screen-probe-traces': { light: 0, chain: true },
  'reflection-traces': { light: 0, chain: true },
  'radiance-cache-probes': { light: 0, chain: true },
  'scene-visualization': { light: 0, chain: true },
  'heterogeneous-volumes-dda-marching': { light: 0, chain: true },
  'heterogeneous-volumes-sample-marching': { light: 0, chain: true },
  'heterogeneous-volumes-sample-majorant': { light: 0, chain: true },
  'heterogeneous-volumes-sample-max-majorant': { light: 0, chain: true },
  'heterogeneous-volumes-sample-majorant-dda': { light: 0, chain: true },
  'heterogeneous-volumes-delta-tracking': { light: 0, chain: true },
  'heterogeneous-volumes-ratio-tracking': { light: 0, chain: true },
  'heterogeneous-volumes-spectral-ratio-tracking': { light: 0, chain: true },
  'heterogeneous-volumes-tracking-majorant-dda': { light: 0, chain: true },
} as const satisfies Partial<Record<DiagnosticMode, LitView>>

type LitView = { light: number; chain: boolean; raw?: boolean; taa?: number }
const litOf = (mode: DiagnosticMode): LitView | undefined =>
  (LIT_VIEWS as Partial<Record<DiagnosticMode, LitView>>)[mode]

/** Whether `mode` draws the lit image: beauty, or one of its views (`LIT_VIEWS`). */
export const drawsLit = (mode: DiagnosticMode) => mode === 'beauty' || !!litOf(mode)

/** Whether `mode` keeps the whole beauty chain: beauty, or a lit view that keeps it. */
export const keepsBeautyChain = (mode: DiagnosticMode) => mode === 'beauty' || !!litOf(mode)?.chain

/** The lighting term `mode` shows in place of the lit surface (`LIT_VIEWS`), zero for none. */
export const lightViewCode = (mode: DiagnosticMode) => litOf(mode)?.light ?? 0

/** The view of the irradiance the probes bounced, alone, raw: the host asks for it (`lightingView`
 *  `'bounce'`, no diagnostic mode) and the frame is lit with the program that reads the probes. */
export const BOUNCE_LIGHT_VIEW = 4

/** Whether `mode` is shown in raw values: a view the resolve paints, or a lit view that measures
 *  (`LIT_VIEWS`). */
export const showsRaw = (mode: DiagnosticMode) => !drawsLit(mode) || !!litOf(mode)?.raw

/** What the temporal resolve outputs for `mode` in place of the accumulated colour (`LIT_VIEWS`),
 *  zero for the colour itself. */
export const taaViewCode = (mode: DiagnosticMode) => litOf(mode)?.taa ?? 0
