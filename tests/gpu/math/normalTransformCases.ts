// The cases `xformNormal` (`NORMAL_TRANSFORM_WGSL`, `standardLighting.ts`) is probed on: ordinary
// ones — a world pose, a local normal, the true world normal in f64 —, then singular ones,
// flattened and collapsed. The same list feeds the arithmetic unit test with no GPU
// (`packages/sdk-browser/src/gpu/shader/normalTransform.test.ts`) and the shipped shader on Dawn
// (`tests/gpu/math/normal-transform.gpu.ts`): the f32 model and the real shader answer on the SAME
// inputs, or their agreement would mean nothing.
import { LIT_MATERIAL as MATERIAL, lightingCase } from './lightingNormalCases.ts'

/** s³ = 1e-20: the uniform scale under which an absolute threshold fires. */
export const THRESHOLD_SCALE = Math.cbrt(1e-20)

const AXES = [
  [1, 0, 0],
  [0, 1, 0],
  [0.5773502691896258, 0.5773502691896258, 0.5773502691896258],
]
const NORMALS = [
  [0, 0, 1],
  [0.6, -0.8, 0],
]
/** From 1e3 to 1e-16, on both sides of the threshold: the cases bracket it instead of avoiding it. */
const SCALES = [1e3, 1, 1e-3, 1e-6, 2.16e-7, 2.154e-7, 1e-7, 1e-8, 1e-12, 1e-16]

export const CASES = SCALES.flatMap((s) =>
  (['uniform', 'anisotropic'] as const).flatMap((kind) =>
    AXES.flatMap((axis) =>
      [37, 90, 180].flatMap((angleDeg) =>
        NORMALS.map((normal) => lightingCase({ s, kind, axis, angleDeg, normal, ...MATERIAL })),
      ),
    ),
  ),
)

/** A column-major 4×4 from three 3D columns and no translation. */
const pose = (columns: number[][]): number[] => [
  ...columns[0],
  0,
  ...columns[1],
  0,
  ...columns[2],
  0,
  0,
  0,
  0,
  1,
]
const TINY_ROTATION = [
  [1e-8, 0, 0],
  [0, -1e-8, 0],
  [0, 0, -1e-8],
]
const ZERO = [0, 0, 0]
const SINGULAR_NORMAL = [0.6, -0.8, 0]

/** A singular case: its pose, its local normal, and the world normal the convention requires. */
const singular = (name: string, columns: number[][], normal: number[], truth: number[]) => ({
  name,
  world: pose(columns),
  normal,
  truth,
  singular: true,
  collapsed: truth === ZERO,
  ...MATERIAL,
})

/**
 * SINGULAR POSES THAT KEEP A FACE (rank 2). The primitive is crushed onto a PLANE, its faces keep
 * an area there, and the world normal is the transformed face's — the cross product of its
 * transformed edges. Both expectations are worked out by hand here, never through the kernel.
 *
 *  — `scale (1,1,0) then 90° about Y` is THE audit's counter-example. Ry(90°) sends x to −z and z
 *    to x; composed with diag(1, 1, 0) its columns are (0,0,−1), (0,1,0), (0,0,0). The local
 *    triangle (0,0,0), (1,0,0), (0,1,0) becomes (0,0,0), (0,0,−1), (0,1,0): world edges (0,0,−1)
 *    and (0,1,0), cross product (1, 0, 0), area 0.5 — a face fully visible and oriented. Its LOCAL
 *    normal is (0,0,1); the world one is +X. A fallback to +Z, the unrotated local
 *    normal, would give about 0.09 of light per channel instead of 0.8; a CPU path returning zero
 *    would give none.
 *  — `zero column` crushes the y axis: columns (1e-8,0,0), (0,0,0), (0,0,−1e-8), onto the XZ plane
 *    of normal ±Y. The local normal (0.6, −0.8, 0) is that of edges (0.8; 0.6; 0) and (0,0,1);
 *    transformed, (8e-9, 0, 0) and (0, 0, −1e-8), whose cross product is (0, 8e-17, 0): +Y. The
 *    local normal's −y does not survive — on a flattened face every vertex normal falls onto the
 *    face normal, smoothing goes with the volume, and the EDGES' orientation decides the side.
 */
export const FLATTENED = [
  singular(
    'flattened face: scale (1,1,0) then 90° about Y',
    [[0, 0, -1], [0, 1, 0], ZERO],
    [0, 0, 1],
    [1, 0, 0],
  ),
  singular(
    'zero column (rank 2, the face keeps its area)',
    [TINY_ROTATION[0], ZERO, TINY_ROTATION[2]],
    SINGULAR_NORMAL,
    [0, 1, 0],
  ),
]

/**
 * POSES THAT COLLAPSE THE FACE: no world area left, hence no normal, hence no light. The
 * expectation is the ZERO vector — finite, never a NaN that screen derivatives would spread to the
 * neighbouring pixels, never the local normal of a surface that does not exist.
 *
 *  — `zero 3×3` and `rank 1` collapse the primitive onto a point or a line: the adjugate is zero by
 *    itself, every cross product of parallel columns being zero.
 *  — `infinite coefficient` and `NaN coefficient` are no poses: the sum of absolute values is not
 *    finite, the normalised 3×3 is worthless, and the kernel zeroes its adjugate. Neither should
 *    reach the shader — `assertFiniteTransform` refuses them at load and at `setTransform` — but
 *    the kernel does not assume it.
 */
export const COLLAPSED = [
  singular('zero 3×3 (zero sum)', [ZERO, ZERO, ZERO], SINGULAR_NORMAL, ZERO),
  singular(
    'rank 1 (three columns on one axis)',
    [
      [1, 0, 0],
      [2, 0, 0],
      [-1, 0, 0],
    ],
    SINGULAR_NORMAL,
    ZERO,
  ),
  singular(
    'infinite coefficient',
    [[Infinity, 0, 0], TINY_ROTATION[1], TINY_ROTATION[2]],
    SINGULAR_NORMAL,
    ZERO,
  ),
  singular(
    'NaN coefficient',
    [[NaN, 0, 0], TINY_ROTATION[1], TINY_ROTATION[2]],
    SINGULAR_NORMAL,
    ZERO,
  ),
]

/**
 * The guard is not greedy: a tiny but regular pose must rotate.
 *
 * `TINY_ROTATION` is diag(1e-8, −1e-8, −1e-8): a half-turn about x at scale 1e-8, determinant
 * +1e-24. Its inverse-transpose is diag(1e8, −1e8, −1e8), and the local normal [0.6, −0.8, 0]
 * becomes [6e7, 8e7, 0], [0.6, 0.8, 0] once unit. The half-turn flips y and z, not x. The
 * expectation once carried here was [−0.6, −0.8, 0], the OPPOSITE: the criterion of the time took
 * the dot product's absolute value, confused N and −N, and passed that error at zero degrees.
 * `normalVerdict`'s oriented criterion refuses it.
 */
export const TINY_REGULAR = {
  name: 'scale-1e-8 rotation (regular)',
  world: pose(TINY_ROTATION),
  normal: SINGULAR_NORMAL,
  truth: [0.6, 0.8, 0],
  singular: false,
  collapsed: false,
  ...MATERIAL,
}
