/**
 * Navigation hierarchy and metadata for the documentation portal.
 * All entries map to unique hash routes (e.g. #guides/quick-start or #api/multiplyMatrix4).
 */
export const MENU_SECTIONS = [
  {
    id: 'guides',
    title: 'Getting Started & Guides',
    items: [
      { id: 'quick-start', title: 'Quick Start', tag: 'Guide' },
      { id: 'architecture', title: 'Architecture & Rules', tag: 'Overview' },
      { id: 'three-migration', title: 'Three.js Migration', tag: 'Guide' },
    ],
  },
  {
    id: 'demo',
    title: 'Interactive Demo',
    items: [{ id: 'webgpu-demo', title: 'Live WebGPU Viewport', tag: 'Interactive' }],
  },
  {
    id: 'examples',
    title: 'Basic Examples',
    items: [
      { id: 'example-scene', title: 'Engine & Scene Setup', tag: 'Example' },
      { id: 'example-camera', title: 'Camera & Projection Setup', tag: 'Example' },
      { id: 'example-batch', title: 'Batch Processing Pipeline', tag: 'Example' },
      { id: 'example-diagnostics', title: 'Visual Diagnostic Modes', tag: 'Example' },
    ],
  },
  {
    id: 'constants-enums',
    title: 'Constants & Enums',
    items: [
      { id: 'IDENTITY_MATRIX4', title: 'IDENTITY_MATRIX4', tag: 'Constant' },
      { id: 'Side', title: 'Side', tag: 'Enum' },
      { id: 'DiagnosticMode', title: 'DiagnosticMode', tag: 'Enum' },
      { id: 'MathPathMode', title: 'MathPathMode & MathPath', tag: 'Enum' },
      { id: 'LodQualityId', title: 'LodQualityId', tag: 'Enum' },
      { id: 'JobStatus', title: 'JobStatus', tag: 'Enum' },
      { id: 'CapabilityTier', title: 'CapabilityTier', tag: 'Enum' },
      { id: 'GpuTimingMethod', title: 'GpuTimingMethod', tag: 'Enum' },
      { id: 'ColumnKind', title: 'ColumnKind', tag: 'Enum' },
      { id: 'ScreenErrorVariant', title: 'ScreenErrorVariant', tag: 'Enum' },
    ],
  },
  {
    id: 'api-lifecycle',
    title: 'API — Engine Lifecycle',
    items: [
      { id: 'prepare', title: 'prepare()', tag: 'Lifecycle' },
      { id: 'createExplorer', title: 'createExplorer()', tag: 'Lifecycle' },
    ],
  },
  {
    id: 'api-camera',
    title: 'API — Camera & Projection',
    items: [
      { id: 'createEngineCamera', title: 'createEngineCamera()', tag: 'Camera' },
      { id: 'defaultEngineCamera', title: 'defaultEngineCamera()', tag: 'Camera' },
      { id: 'writeEngineCamera', title: 'writeEngineCamera()', tag: 'Camera' },
      { id: 'readCameraWorld', title: 'readCameraWorld()', tag: 'Camera' },
      { id: 'holdCameraWorld', title: 'holdCameraWorld()', tag: 'Camera' },
      { id: 'createCameraFrame', title: 'createCameraFrame()', tag: 'Camera' },
      { id: 'updateCameraFrame', title: 'updateCameraFrame()', tag: 'Camera' },
      { id: 'perspectiveProjection', title: 'perspectiveProjection()', tag: 'Camera' },
      { id: 'enginePose', title: 'enginePose()', tag: 'Camera' },
    ],
  },
  {
    id: 'api-vectors',
    title: 'API — Vectors (Vector3)',
    items: [
      { id: 'dotVector3', title: 'dotVector3()', tag: 'Vector' },
      { id: 'crossVector3', title: 'crossVector3()', tag: 'Vector' },
      { id: 'lengthSqVector3', title: 'lengthSqVector3()', tag: 'Vector' },
      { id: 'scaleVector3', title: 'scaleVector3()', tag: 'Vector' },
      { id: 'copyScaledVector3', title: 'copyScaledVector3()', tag: 'Vector' },
      { id: 'transformAffinePoint', title: 'transformAffinePoint()', tag: 'Vector' },
      { id: 'normalizeVector3', title: 'normalizeVector3()', tag: 'Vector' },
    ],
  },
  {
    id: 'api-matrices',
    title: 'API — Matrices (Matrix4)',
    items: [
      { id: 'multiplyMatrix4', title: 'multiplyMatrix4()', tag: 'Matrix' },
      { id: 'invertMatrix4', title: 'invertMatrix4()', tag: 'Matrix' },
      { id: 'composeMatrix4', title: 'composeMatrix4()', tag: 'Matrix' },
      { id: 'decomposeMatrix4', title: 'decomposeMatrix4()', tag: 'Matrix' },
      { id: 'basisMatrix4', title: 'basisMatrix4()', tag: 'Matrix' },
      { id: 'uniformScaleMatrix4', title: 'uniformScaleMatrix4()', tag: 'Matrix' },
      { id: 'copyMatrix4', title: 'copyMatrix4()', tag: 'Matrix' },
      { id: 'determinantMatrix4', title: 'determinantMatrix4()', tag: 'Matrix' },
      { id: 'linearPartDeterminant', title: 'linearPartDeterminant()', tag: 'Matrix' },
    ],
  },
  {
    id: 'api-colors',
    title: 'API — Colors',
    items: [
      { id: 'srgbToLinear', title: 'srgbToLinear()', tag: 'Color' },
      { id: 'linearToSrgb', title: 'linearToSrgb()', tag: 'Color' },
      { id: 'hslToLinearRgb', title: 'hslToLinearRgb()', tag: 'Color' },
    ],
  },
  {
    id: 'api-batches',
    title: 'API — Batch Processing',
    items: [
      { id: 'multiplyMatrix4Batch', title: 'multiplyMatrix4Batch()', tag: 'Batch' },
      { id: 'invertMatrix4Batch', title: 'invertMatrix4Batch()', tag: 'Batch' },
      { id: 'transformAffinePointsBatch', title: 'transformAffinePointsBatch()', tag: 'Batch' },
      { id: 'cullFrustumBoxesBatch', title: 'cullFrustumBoxesBatch()', tag: 'Batch' },
      { id: 'boundingSpheresBatch', title: 'boundingSpheresBatch()', tag: 'Batch' },
      {
        id: 'boundingSpheresTransformBatch',
        title: 'boundingSpheresTransformBatch()',
        tag: 'Batch',
      },
      { id: 'srgbToLinearBatch', title: 'srgbToLinearBatch()', tag: 'Batch' },
      { id: 'linearToSrgbBatch', title: 'linearToSrgbBatch()', tag: 'Batch' },
      { id: 'hslToLinearRgbBatch', title: 'hslToLinearRgbBatch()', tag: 'Batch' },
      { id: 'nodeWorldFramesBatch', title: 'nodeWorldFramesBatch()', tag: 'Batch' },
    ],
  },
  {
    id: 'api-materials',
    title: 'API — Materials & Raster',
    items: [
      { id: 'sideOf', title: 'sideOf()', tag: 'Material' },
      { id: 'materialSide', title: 'materialSide()', tag: 'Material' },
    ],
  },
];
