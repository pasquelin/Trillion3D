/** Batch math: `n` elements per call on flat buffers, the governor that arbitrates the paths. */
const BATCH = { section: 'batches', kind: 'Function', module: 'packages/sdk-core/mathBatch.ts' };

export const BATCHES = [
  {
    ...BATCH,
    id: 'multiplyMatrix4Batch',
    exports: ['multiplyMatrix4Batch'],
    title: 'multiplyMatrix4Batch()',
    signature: 'multiplyMatrix4Batch(out: Float64Array[], a: Float64Array[], b: Float64Array[], n)',
    description:
      '`n` products `out[i] = a[i] · b[i]`, all three sides given as sub-views of sixteen numbers. The sub-views are built once, never per frame; a WebAssembly kernel repeats the same formula term by term and the governor picks whichever path is measured faster.',
    replaces: 'a loop of Matrix4.multiplyMatrices',
  },
  {
    ...BATCH,
    id: 'boxTransformBatch',
    exports: ['boxTransformBatch'],
    title: 'boxTransformBatch()',
    signature: 'boxTransformBatch(out: Float64Array, boxes, mats: ArrayLike<number>[], n)',
    description:
      '`n` boxes transformed by `n` matrices: `out[i] = boxTransform(boxes[i], mats[i])`. `out` and `boxes` carry six numbers per element, `mats` a sub-view of sixteen.',
    replaces: 'a loop of Box3.applyMatrix4',
  },
  {
    ...BATCH,
    id: 'hierarchyUpdateBatch',
    exports: [
      'hierarchyUpdateBatch',
      'HIERARCHY_ROOT',
      'MATRIX_VALUES',
      'POSITION_VALUES',
      'QUATERNION_VALUES',
      'SPHERE_VALUES',
      'NORMAL_MATRIX_VALUES',
    ],
    title: 'hierarchyUpdateBatch()',
    signature:
      'hierarchyUpdateBatch(worldViews, positions, rotations, scales, parents: Uint32Array, n, local)\nHIERARCHY_ROOT = 0xffffffff · MATRIX_VALUES = 16 · POSITION_VALUES = 3 · QUATERNION_VALUES = 4 · SPHERE_VALUES = 4 · NORMAL_MATRIX_VALUES = 9',
    description:
      "A full hierarchy updated in one pass: `n` nodes ordered parents before children, each composing its local matrix then multiplying it by its parent's world matrix — the traversal of `mathTransformTreeUpdate.ts`, the same two formulas in the same order, on flat buffers. `parents[i]` **must** index an already updated node, hence strictly less than `i`; any other value — the `HIERARCHY_ROOT` sentinel included — makes the node a root whose world matrix is its local matrix. The rule is identical on both paths: no input, however hostile, can make them diverge. `local` is one scratch matrix, reused by every element.",
    replaces: 'Object3D.updateMatrixWorld over a whole scene',
  },
  {
    ...BATCH,
    id: 'createPathGovernor',
    exports: ['createPathGovernor', 'PATH_MIN_SAMPLES', 'PATH_SWITCH_RUNS', 'PATH_EXPLORE_EVERY'],
    title: 'createPathGovernor()',
    module: 'packages/sdk-core/mathPathGovernor.ts',
    signature:
      "createPathGovernor(now: () => number, mode: MathPathMode = 'auto'): PathGovernor\nPATH_MIN_SAMPLES = 5 · PATH_SWITCH_RUNS = 5 · PATH_EXPLORE_EVERY = 50",
    description:
      'What arbitrates JS against WebAssembly, per named operation: sliding medians of nanoseconds per element, a switch only after five consecutive executions at that lead, and one execution in fifty replaying the other path to refresh its median. Under five samples nothing is decided — a single value would make the median. `metrics()` publishes, per operation, `path`, `jsNsPerElement`, `wasmNsPerElement`, the switch count, and the clock resolution the measurement rests on.',
  },
  {
    ...BATCH,
    id: 'frustumKeepsBoxBatch',
    exports: ['frustumKeepsBoxBatch', 'sphereFromBoundsBatch'],
    title: 'frustumKeepsBoxBatch() · sphereFromBoundsBatch()',
    module: 'packages/sdk-core/mathBatchCulling.ts',
    signature:
      'frustumKeepsBoxBatch(kept: Uint8Array, planes: Float64Array, boxes, n): number\nsphereFromBoundsBatch(out: Float64Array, boxes, n)',
    description:
      '`n` boxes of six numbers (min then max) against the twenty-four floats of a frustum: `kept[i]` is 1 where the box intersects or sits inside, and the count kept is returned — `frustumExcludesBox` negated, the polarity the reference answers in. The sphere batch writes four numbers per box, centre then radius to the corner, as `sphereFromBounds` does.',
    replaces: 'a loop of Frustum.intersectsBox, of Box3.getBoundingSphere',
  },
  {
    ...BATCH,
    id: 'boxUnionBatch',
    exports: ['boxUnionBatch', 'boxTransformUnionBatch'],
    title: 'boxUnionBatch() · boxTransformUnionBatch()',
    signature:
      'boxUnionBatch(into: Float64Array, boxes, n)\nboxTransformUnionBatch(into: Float64Array, boxes, mats: ArrayLike<number>[], n)',
    description:
      '`into` grown by `n` boxes, or by `n` boxes each transformed by its own matrix first — one pass, one scratch box, no allocation. Both repeat `boxUnion`, the second `boxTransform` before it: the world bounds of a whole scene in one call.',
    replaces: 'a loop of Box3.union, Box3.setFromObject',
  },
  {
    ...BATCH,
    id: 'invertMatrix4Batch',
    exports: [
      'invertMatrix4Batch',
      'normalMatrix3Batch',
      'composeMatrix4Batch',
      'decomposeMatrix4Batch',
    ],
    title:
      'invertMatrix4Batch() · normalMatrix3Batch() · composeMatrix4Batch() · decomposeMatrix4Batch()',
    module: 'packages/sdk-core/mathBatchTransforms.ts',
    signature:
      'invertMatrix4Batch(out: Float64Array[], mats, n, singular?: Uint8Array)\nnormalMatrix3Batch(out: Float64Array, mats, n)\ncomposeMatrix4Batch(out, positions, quaternions, scales, n)\ndecomposeMatrix4Batch(positions, quaternions, scales, mats, n)',
    description:
      '`n` inverses, `n` normal matrices of nine numbers, `n` compositions `T · R · S`, `n` decompositions. A matrix with a zero determinant is inverted to the identity and flagged in `singular[i]` — never a throw in the middle of a batch. `composeMatrix4Batch` takes everything flat or everything as sub-views, and settles the form before the loop.',
    replaces: 'a loop of Matrix4.invert, getNormalMatrix, compose, decompose',
  },
  {
    ...BATCH,
    id: 'transformPointsBatch',
    exports: ['transformPointsBatch', 'transformPointsByMatricesBatch', 'transformDirectionsBatch'],
    title: 'transformPointsBatch() · transformPointsByMatricesBatch() · transformDirectionsBatch()',
    module: 'packages/sdk-core/mathBatchPoints.ts',
    signature:
      'transformPointsBatch(out: Float64Array, m, points, n)\ntransformPointsByMatricesBatch(out: Float64Array, mats: ArrayLike<number>[], points, n)\ntransformDirectionsBatch(out: Float64Array, m, dirs, n)',
    description:
      '`n` points of three numbers by one affine matrix, or one matrix per point; `n` directions by the upper 3×3 then normalized, translation ignored. They repeat `transformAffinePoint` and `transformDirectionVector3`.',
    replaces: 'a loop of Vector3.applyMatrix4, of Vector3.transformDirection',
  },
  {
    ...BATCH,
    id: 'srgbToLinearBatch',
    exports: ['srgbToLinearBatch', 'linearToSrgbBatch'],
    title: 'srgbToLinearBatch() · linearToSrgbBatch()',
    module: 'packages/sdk-core/mathBatchColor.ts',
    signature:
      'srgbToLinearBatch(out: Float64Array, values, n)\nlinearToSrgbBatch(out: Float64Array, values, n)',
    description:
      'One channel per element, the exact curves of `mathColor.ts`: the reference multiplies by rounded constants, and the gap — invisible at 8 bits — is bounded once, in the bench that duels it.',
    replaces: 'a loop of Color.convertSRGBToLinear, convertLinearToSRGB',
  },
];
