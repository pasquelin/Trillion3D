/**
 * API reference for Engine Lifecycle and Batch Math operations (#80).
 */
export const BATCH_LIFECYCLE_CONTENT = {
  // Engine Lifecycle
  prepare: {
    title: 'prepare(options)',
    type: 'Function',
    category: 'Lifecycle',
    signature: 'prepare(options: PrepareOptions): Promise<PreparedScene>',
    description:
      'Loads and mounts pre-compiled cluster manifests and textures into GPU virtual memory pages.',
    replaces: 'GLTFLoader.loadAsync()',
    proof: 'Engine test harness',
    example: `const scene = await prepare({ assetUrl: '/models/building.manifest.bin' });`,
  },
  createExplorer: {
    title: 'createExplorer(options)',
    type: 'Function',
    category: 'Lifecycle',
    signature: 'createExplorer(options: ExplorerOptions): Promise<RenderBackend>',
    description:
      'Initializes the WebGPU rendering pipeline, camera controller, DAG traversal, and visibility buffer.',
    replaces: 'new WebGLRenderer() + scene loops',
    proof: 'Explorer integration tests',
    example: `const explorer = await createExplorer({ canvas, scene });`,
  },
  // Batch Math
  multiplyMatrix4Batch: {
    title: 'multiplyMatrix4Batch(out, a, b, n)',
    type: 'Function',
    category: 'Batch',
    signature:
      'multiplyMatrix4Batch(out: Float64Array, a: Float64Array, b: Float64Array, n: number): void',
    description:
      'Multiplies n pairs of 4×4 matrices stored contiguously in flat Float64Array buffers.',
    replaces: 'Loop of Matrix4.multiplyMatrices()',
    proof: 'perf:core batch benchmark',
    example: `multiplyMatrix4Batch(worlds, parents, locals, 10000);`,
  },
  invertMatrix4Batch: {
    title: 'invertMatrix4Batch(out, m, n, singularOut?)',
    type: 'Function',
    category: 'Batch',
    signature:
      'invertMatrix4Batch(out: Float64Array, m: Float64Array, n: number, singularOut?: Uint8Array): void',
    description:
      'Computes matrix inverses across n contiguous 4×4 matrices without dynamic allocation.',
    replaces: 'Loop of Matrix4.invert()',
    proof: 'perf:core batch benchmark',
    example: `invertMatrix4Batch(inverses, matrices, count, flags);`,
  },
  transformAffinePointsBatch: {
    title: 'transformAffinePointsBatch(out, m, points, n)',
    type: 'Function',
    category: 'Batch',
    signature:
      'transformAffinePointsBatch(out: Float64Array, m: Float64Array, points: Float64Array, n: number): void',
    description: 'Transforms n consecutive 3D points by a single 4×4 affine matrix.',
    replaces: 'Vector3.applyMatrix4() loops',
    proof: 'perf:core batch benchmark',
    example: `transformAffinePointsBatch(worldVertices, m, localVertices, vertexCount);`,
  },
  cullFrustumBoxesBatch: {
    title: 'cullFrustumBoxesBatch(visibilityOut, planes, boxes, n)',
    type: 'Function',
    category: 'Batch',
    signature:
      'cullFrustumBoxesBatch(visibilityOut: Uint8Array, planes: Float64Array, boxes: Float64Array, n: number): number',
    description:
      'Tests n axis-aligned bounding boxes (min/max 6 numbers each) against 6 frustum planes in one vectorized pass.',
    replaces: 'Loop of Frustum.intersectsBox()',
    proof: 'perf:core batch benchmark',
    example: `const visibleCount = cullFrustumBoxesBatch(visMask, camPlanes, bboxes, clusterCount);`,
  },
  boundingSpheresBatch: {
    title: 'boundingSpheresBatch(spheresOut, boxes, n)',
    type: 'Function',
    category: 'Batch',
    signature:
      'boundingSpheresBatch(spheresOut: Float64Array, boxes: Float64Array, n: number): void',
    description:
      'Generates bounding spheres (center xyz, radius r) for n bounding boxes (4 floats per sphere).',
    replaces: 'Box3.getBoundingSphere() loops',
    proof: 'perf:core batch benchmark',
    example: `boundingSpheresBatch(spheres, boxes, n);`,
  },
  boundingSpheresTransformBatch: {
    title: 'boundingSpheresTransformBatch(spheresOut, m, spheresIn, n)',
    type: 'Function',
    category: 'Batch',
    signature:
      'boundingSpheresTransformBatch(spheresOut: Float64Array, m: Float64Array, spheresIn: Float64Array, n: number): void',
    description:
      'Transforms n bounding spheres by a 4×4 affine matrix (translating center and scaling radius by max axis scale).',
    replaces: 'Sphere.applyMatrix4() loops',
    proof: 'perf:core batch benchmark',
    example: `boundingSpheresTransformBatch(worldSpheres, modelMatrix, localSpheres, count);`,
  },
  srgbToLinearBatch: {
    title: 'srgbToLinearBatch(out, inColors, n)',
    type: 'Function',
    category: 'Batch',
    signature: 'srgbToLinearBatch(out: Float64Array, inColors: Float64Array, n: number): void',
    description:
      'Batch converts n color channels from display sRGB to linear photometric radiance.',
    replaces: 'Per-material color conversion loops',
    proof: 'perf:core batch benchmark',
    example: `srgbToLinearBatch(linearColors, srgbColors, count * 3);`,
  },
  linearToSrgbBatch: {
    title: 'linearToSrgbBatch(out, inColors, n)',
    type: 'Function',
    category: 'Batch',
    signature: 'linearToSrgbBatch(out: Float64Array, inColors: Float64Array, n: number): void',
    description: 'Batch converts n color channels from linear space to sRGB gamma curve.',
    replaces: 'Color conversion loops',
    proof: 'perf:core batch benchmark',
    example: `linearToSrgbBatch(srgbOut, linearIn, count * 3);`,
  },
  hslToLinearRgbBatch: {
    title: 'hslToLinearRgbBatch(out, hslIn, n)',
    type: 'Function',
    category: 'Batch',
    signature: 'hslToLinearRgbBatch(out: Float64Array, hslIn: Float64Array, n: number): void',
    description: 'Batch converts n HSL color triplets into linear RGB space.',
    replaces: 'Color.setHSL() loops',
    proof: 'perf:core batch benchmark',
    example: `hslToLinearRgbBatch(linearRgb, hslSource, count);`,
  },
  nodeWorldFramesBatch: {
    title: 'nodeWorldFramesBatch(worldOut, parentIndices, localTransforms, n)',
    type: 'Function',
    category: 'Batch',
    signature:
      'nodeWorldFramesBatch(worldOut: Float64Array, parentIndices: Int32Array, localTransforms: Float64Array, n: number): void',
    description:
      'Evaluates entire scene hierarchy transform tree topologically in an allocation-free flat batch.',
    replaces: 'Recursive Object3D.updateMatrixWorld()',
    proof: 'hierarchy.perf.mjs benchmark',
    example: `nodeWorldFramesBatch(worlds, parents, locals, nodeCount);`,
  },
};
