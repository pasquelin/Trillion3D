/** Availability describes real pipeline outputs, never synthetic overlays. */
export type DiagnosticMode =
  | 'beauty'
  | 'wireframe'
  | 'clusters'
  | 'lod'
  | 'screen-error'
  | 'materials'
  | 'visibility'
  | 'pages'
  | 'texture-mip'
  | 'overdraw';
/** Whether a view mode is available here, and why not. */
export interface DiagnosticCapability {
  /** Whether it can be shown. */
  available: boolean;
  /** Why not. */
  reason: string;
}
/** Every view mode, each with whether it is available.
 *  @property beauty - The normal image. @property wireframe - One colour per triangle.
 *  @property clusters - One colour per cluster. @property lod - The detail level drawn.
 *  @property screen-error - The error on screen. @property materials - One colour per material.
 *  @property visibility - The pages seen. @property pages - The pages held.
 *  @property texture-mip - The texture size read. @property overdraw - Pixels drawn again. */
export type DiagnosticCapabilities = Record<DiagnosticMode, DiagnosticCapability>;
/**
 * The view modes a world can show instead of the normal image, each with whether it is available.
 * @property beauty - The normal image.
 * @property wireframe - One colour per triangle.
 * @property clusters - One colour per cluster.
 * @property lod - Which detail level each cluster was drawn at.
 * @property screen-error - How far each cluster is from the full detail, on screen.
 * @property materials - One colour per kind of material.
 * @property visibility - The pages seen this frame.
 * @property pages - The pages held in memory.
 * @property texture-mip - Which texture size each pixel read.
 * @property overdraw - How many times each pixel was drawn.
 */
export const DIAGNOSTICS: DiagnosticCapabilities = {
  beauty: { available: true, reason: 'glTF materials' },
  wireframe: {
    available: true,
    reason: 'Filled unique color per submitted triangle, not GL_LINES wireframe',
  },
  clusters: { available: true, reason: 'Stable primitive/page ID, exact-cluster backend only' },
  lod: {
    available: true,
    reason: 'Level-0 clusters vs coarser DAG reductions actually selected this frame',
  },
  'screen-error': {
    available: true,
    reason: 'Per-cluster screen error projected through the cluster sphere, as the cut uses it',
  },
  materials: {
    available: true,
    reason:
      'One colour per material class, the class pass that resolved the pixel; WebGPU visibility path only',
  },
  visibility: {
    available: true,
    reason: 'Selected visible pages; rejected hierarchy nodes are counted, not drawn',
  },
  pages: {
    available: true,
    reason: 'Attached index pages; missing pages are not drawn; not physical VRAM',
  },
  'texture-mip': { available: false, reason: 'Texture mip residency not instrumented' },
  overdraw: { available: false, reason: 'No fragment counter' },
};
