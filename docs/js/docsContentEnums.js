/**
 * Complete documentation for engine Constants and Enums.
 */
export const ENUMS_CONTENT = {
  IDENTITY_MATRIX4: {
    title: 'IDENTITY_MATRIX4',
    type: 'Constant',
    category: 'Constants',
    signature: 'const IDENTITY_MATRIX4: Float64Array',
    description:
      'Immutable 16-element Float64Array representing the standard 4×4 identity matrix in column-major order.',
    notes:
      'Replaces Three.js Matrix4.identity(). Used as an unmodifiable reference across scene transforms and fallback frames.',
    values: [
      {
        name: '[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]',
        desc: 'Diagonal ones, column-major storage layout.',
      },
    ],
    example: `import { IDENTITY_MATRIX4, copyMatrix4 } from '@web-geometry/sdk/core';

// Reset local matrix to identity without allocating memory:
copyMatrix4(nodeTransform, IDENTITY_MATRIX4);`,
  },
  Side: {
    title: 'Side',
    type: 'Type / Enum',
    category: 'Enums',
    signature: "type Side = 'front' | 'back' | 'double'",
    description: 'Specifies which polygon faces of a surface are rendered and shaded.',
    notes:
      'Replaces Three.js FrontSide, BackSide, and DoubleSide constants. Evaluated during cluster cone culling and raster pass setup.',
    values: [
      {
        name: "'front'",
        desc: 'Only front-facing triangles are drawn (default for opaque meshes).',
      },
      { name: "'back'", desc: 'Only back-facing triangles are drawn (used for inside-out hulls).' },
      { name: "'double'", desc: 'Both sides are rasterized (leaves, fabric, thin cutouts).' },
    ],
    example: `import { sideOf } from '@web-geometry/sdk/browser';

const side = sideOf(material);
if (side === 'double') {
  // Rasterize without backface culling
}`,
  },
  DiagnosticMode: {
    title: 'DiagnosticMode',
    type: 'Type / Enum',
    category: 'Enums',
    signature:
      "type DiagnosticMode = 'none' | 'clusters' | 'triangles' | 'error' | 'overdraw' | 'cost' | 'normals' | 'uv' | 'depth' | 'wireframe' | 'cpu-timing'",
    description: 'Selects the visual diagnostic overlay or analysis pipeline for GPU rendering.',
    notes: 'Configured on the active RenderBackend via backend.setDiagnostic(mode).',
    values: [
      { name: "'none'", desc: 'Full beauty composition (standard PBR lighting).' },
      { name: "'clusters'", desc: 'Colors each cluster with a deterministic pseudorandom hue.' },
      { name: "'triangles'", desc: 'Heatmap of triangle counts drawn per cluster.' },
      { name: "'error'", desc: 'Screen-space error metric visualized across clusters.' },
      { name: "'overdraw'", desc: 'Fragment overdraw heatmap from visibility raster.' },
      { name: "'cost'", desc: 'Relative execution duration per cluster.' },
      { name: "'normals'", desc: 'Geometric world normals mapped to RGB colors.' },
      { name: "'uv'", desc: 'Texture coordinate visualization.' },
      { name: "'depth'", desc: 'Reversed float depth gradient.' },
      { name: "'wireframe'", desc: 'Cluster triangle wireframe overlays.' },
      { name: "'cpu-timing'", desc: 'Shows CPU step profiling overlay.' },
    ],
    example: `backend.setDiagnostic('clusters');`,
  },
  MathPathMode: {
    title: 'MathPathMode & MathPath',
    type: 'Type / Enum',
    category: 'Enums',
    signature: "type MathPath = 'js' | 'wasm';\ntype MathPathMode = MathPath | 'auto';",
    description: 'Execution governor setting for batch mathematical operations.',
    notes:
      'Controls whether batches execute via optimized JavaScript loops or WebAssembly kernels.',
    values: [
      { name: "'auto'", desc: 'Governor dynamically selects fastest measured kernel (default).' },
      { name: "'js'", desc: 'Forces pure JavaScript evaluation.' },
      { name: "'wasm'", desc: 'Forces WebAssembly kernel evaluation.' },
    ],
    example: `import { setMathPathMode } from '@web-geometry/sdk/core';

// Force WebAssembly SIMD math path for heavy transforms
setMathPathMode('wasm');`,
  },
  LodQualityId: {
    title: 'LodQualityId',
    type: 'Type / Enum',
    category: 'Enums',
    signature: "type LodQualityId = 'cinematic' | 'epic' | 'high' | 'medium' | 'low'",
    description: 'Predefined screen error tolerance levels governing DAG cluster cut selection.',
    notes: 'Dictates target pixels-per-triangle and maximum allowable screen-space error.',
    values: [
      { name: "'cinematic'", desc: 'Sub-pixel fidelity (target ~1 triangle per pixel).' },
      { name: "'epic'", desc: 'Target error threshold < 0.5 px.' },
      { name: "'high'", desc: 'Target error threshold < 1.0 px (balanced default).' },
      { name: "'medium'", desc: 'Target error threshold < 2.0 px for mobile / iGPU.' },
      { name: "'low'", desc: 'Aggressive simplification for low-end hardware.' },
    ],
    example: `explorer.setQuality('epic');`,
  },
  JobStatus: {
    title: 'JobStatus',
    type: 'Type / Enum',
    category: 'Enums',
    signature: "type JobStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'",
    description:
      'Lifecycle status of background worker tasks (cluster decoding, mesh import, caching).',
    notes: 'Reported by background job controllers and asset compilation workers.',
    values: [
      { name: "'queued'", desc: 'Job is waiting for an available worker thread.' },
      { name: "'running'", desc: 'Actively processing in worker thread.' },
      { name: "'completed'", desc: 'Execution succeeded; output data ready.' },
      { name: "'cancelled'", desc: 'Job aborted by caller before completion.' },
      { name: "'failed'", desc: 'Encountered error during decoding or processing.' },
    ],
    example: `job.on('status', (status: JobStatus) => console.log('Job status:', status));`,
  },
  CapabilityTier: {
    title: 'CapabilityTier',
    type: 'Type / Enum',
    category: 'Enums',
    signature: "type CapabilityTier = 'tier-0' | 'tier-1' | 'tier-2' | 'tier-3'",
    description:
      'Hardware capability classification determined upon WebGPU adapter initialization.',
    notes: 'Restricts cluster memory budgets and optional features (shadow passes, TAA).',
    values: [
      { name: "'tier-0'", desc: 'Minimum WebGPU support (mobile / budget devices).' },
      { name: "'tier-1'", desc: 'Baseline desktop iGPU / mid-tier mobile.' },
      { name: "'tier-2'", desc: 'Mid-range discrete GPU (full feature set enabled).' },
      { name: "'tier-3'", desc: 'High-end desktop GPU (maximum cluster resident cache).' },
    ],
    example: `const tier = explorer.capabilities.tier;`,
  },
  GpuTimingMethod: {
    title: 'GpuTimingMethod',
    type: 'Type / Enum',
    category: 'Enums',
    signature: "type GpuTimingMethod = 'timestamp-query' | 'EXT_disjoint_timer_query_webgl2'",
    description: 'Hardware timer query mechanism used for pass-by-pass GPU execution profiling.',
    values: [
      { name: "'timestamp-query'", desc: 'Native WebGPU timestamp queries.' },
      {
        name: "'EXT_disjoint_timer_query_webgl2'",
        desc: 'WebGL2 disjoint timer extension fallback.',
      },
    ],
    example: `const method = backend.timingMethod;`,
  },
  ColumnKind: {
    title: 'ColumnKind',
    type: 'Type / Enum',
    category: 'Enums',
    signature: "type ColumnKind = 'f64' | 'i32' | 'u32' | 'u8'",
    description: 'Data column storage format within binary cluster manifest files.',
    values: [
      { name: "'f64'", desc: '64-bit IEEE-754 double precision float.' },
      { name: "'i32'", desc: '32-bit signed integer.' },
      { name: "'u32'", desc: '32-bit unsigned integer.' },
      { name: "'u8'", desc: '8-bit unsigned byte.' },
    ],
    example: `const kind: ColumnKind = 'u32';`,
  },
  ScreenErrorVariant: {
    title: 'ScreenErrorVariant',
    type: 'Type / Enum',
    category: 'Enums',
    signature: "type ScreenErrorVariant = 'certifiee' | 'reference'",
    description: 'Algorithm variant used for projected screen-space error bounds.',
    values: [
      { name: "'certifiee'", desc: 'Rigorous bounding-box projection with zero false-negatives.' },
      { name: "'reference'", desc: 'Direct center-radius sphere approximation.' },
    ],
    example: `const variant: ScreenErrorVariant = 'certifiee';`,
  },
};
