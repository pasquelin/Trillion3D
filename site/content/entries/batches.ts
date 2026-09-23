import type { EntryNote } from '../model.ts';

/** Batch math: `n` elements per call on flat buffers, the governor that arbitrates the paths. */

export const BATCHES: EntryNote[] = [
  {
    id: 'multiplyMatrix4Batch',
    description:
      '`n` products `out[i] = a[i] · b[i]`, all three sides given as sub-views of sixteen numbers. The sub-views are built once, never per frame; a WebAssembly kernel repeats the same formula term by term and the governor picks whichever path is measured faster.',
    replaces: 'a loop of Matrix4.multiplyMatrices',
  },
  {
    id: 'boxTransformBatch',
    description:
      '`n` boxes transformed by `n` matrices: `out[i] = boxTransform(boxes[i], mats[i])`. `out` and `boxes` carry six numbers per element, `mats` a sub-view of sixteen.',
    replaces: 'a loop of Box3.applyMatrix4',
  },
  {
    id: 'hierarchyUpdateBatch',
    description:
      "A full hierarchy updated in one pass: `n` nodes ordered parents before children, each composing its local matrix then multiplying it by its parent's world matrix — the traversal of `packages/sdk-core/src/math/transform-tree/update.ts`, the same two formulas in the same order, on flat buffers. `parents[i]` **must** index an already updated node, hence strictly less than `i`; any other value — the `HIERARCHY_ROOT` sentinel included — makes the node a root whose world matrix is its local matrix. The rule is identical on both paths: no input, however hostile, can make them diverge. `local` is one scratch matrix, reused by every element.",
    replaces: 'Object3D.updateMatrixWorld over a whole scene',
  },
  {
    id: 'createPathGovernor',
    description:
      'What arbitrates JS against WebAssembly, per named operation: sliding medians of nanoseconds per element, a switch only after five consecutive executions at that lead, and one execution in fifty replaying the other path to refresh its median. Under five samples nothing is decided — a single value would make the median. `metrics()` publishes, per operation, `path`, `jsNsPerElement`, `wasmNsPerElement`, the switch count, and the clock resolution the measurement rests on.',
  },
  {
    id: 'frustumKeepsBoxBatch',
    description:
      '`n` boxes of six numbers (min then max) against the twenty-four floats of a frustum: `kept[i]` is 1 where the box intersects or sits inside, and the count kept is returned — `frustumExcludesBox` negated, the polarity the reference answers in. The sphere batch writes `SPHERE_VALUES` numbers per box, centre then radius to the corner, as `sphereFromBounds` does. Both loops live in `packages/sdk-core/src/math/batch/culling.ts`.',
    replaces: 'a loop of Frustum.intersectsBox, of Box3.getBoundingSphere',
  },
  {
    id: 'boxUnionBatch',
    description:
      '`into` grown by `n` boxes, or by `n` boxes each transformed by its own matrix first — one pass, one scratch box, no allocation. Both repeat `boxUnion`, the second `boxTransform` before it: the world bounds of a whole scene in one call.',
    replaces: 'a loop of Box3.union, Box3.setFromObject',
  },
  {
    id: 'invertMatrix4Batch',
    description:
      '`n` inverses, `n` normal matrices of `NORMAL_MATRIX_VALUES` numbers, `n` compositions `T · R · S`, `n` decompositions. A matrix with a zero determinant is inverted to the identity and flagged in `singular[i]` — never a throw in the middle of a batch. `composeMatrix4Batch` takes everything flat or everything as sub-views, and settles the form before the loop. The four loops live in `packages/sdk-core/src/math/batch/transforms.ts`.',
    replaces: 'a loop of Matrix4.invert, getNormalMatrix, compose, decompose',
  },
  {
    id: 'transformPointsBatch',
    description:
      '`n` points of three numbers by one affine matrix, or one matrix per point; `n` directions by the upper 3×3 then normalized, translation ignored. They repeat `transformAffinePoint` and `transformDirectionVector3`.',
    replaces: 'a loop of Vector3.applyMatrix4, of Vector3.transformDirection',
  },
  {
    id: 'srgbToLinearBatch',
    description:
      'One channel per element, the exact curves of `packages/sdk-core/src/math/primitives/color.ts`: the reference multiplies by rounded constants, and the gap — invisible at 8 bits — is bounded once, in the bench that duels it.',
    replaces: 'a loop of Color.convertSRGBToLinear, convertLinearToSRGB',
  },
];
