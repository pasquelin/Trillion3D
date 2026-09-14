/** Availability describes real pipeline outputs, never synthetic overlays. */
export type DiagnosticMode =
  | 'beauty'
  | 'wireframe'
  | 'clusters'
  | 'lod'
  | 'screen-error'
  | 'visibility'
  | 'pages'
  | 'texture-mip'
  | 'overdraw';
export interface DiagnosticCapability {
  available: boolean;
  reason: string;
}
export type DiagnosticCapabilities = Record<DiagnosticMode, DiagnosticCapability>;
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
