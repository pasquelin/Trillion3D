// Cases on which `xformNormal` (NORMAL_TRANSFORM_WGSL, standardLighting.ts) is probed:
// ordinary on one side — a world pose, a local normal, the true world normal in f64 —,
// singular on the other, flattened then collapsed. The same list serves the no-GPU
// arithmetic test (`packages/sdk-browser/normalTransform.test.ts`) and running the shipped
// shader in Chromium (`test/browser/normal-transform-arithmetique.browser.ts`): the f32
// model and the real shader answer on the SAME inputs, or else agreement between them
// would mean nothing.
import { construireCas } from './normaleEclairageCas.ts';

/** s³ = 1e-20: the uniform scale under which the old absolute threshold fired. */
export const SEUIL = Math.cbrt(1e-20);
/** Dropout: beyond this, the normal is no longer that of the rotated surface. */
export const DECROCHE_DEG = 1e-3;
export { DEG } from './inverseTransposeF32.ts';

const AXES = [
  [1, 0, 0],
  [0, 1, 0],
  [0.5773502691896258, 0.5773502691896258, 0.5773502691896258],
];
const NORMALES = [
  [0, 0, 1],
  [0.6, -0.8, 0],
];
/** From 1e3 to 1e-16, and on both sides of the threshold: cases bracket it instead of avoiding it. */
const ECHELLES = [1e3, 1, 1e-3, 1e-6, 2.16e-7, 2.154e-7, 1e-7, 1e-8, 1e-12, 1e-16];
const MATIERE = { lumiere: [0.3, 0.8, 0.5, 3], metal: 0.1, rugosite: 0.4 };

export const CAS = ECHELLES.flatMap((s) =>
  ['uniforme', 'anisotrope'].flatMap((kind) =>
    AXES.flatMap((axis) =>
      [37, 90, 180].flatMap((angleDeg) =>
        NORMALES.map((normale) => construireCas({ s, kind, axis, angleDeg, normale, ...MATIERE })),
      ),
    ),
  ),
);

/** A column-major 4×4, built from three 3D columns and a null translation. */
const pose = (colonnes: number[][]): number[] => [
  ...colonnes[0],
  0,
  ...colonnes[1],
  0,
  ...colonnes[2],
  0,
  0,
  0,
  0,
  1,
];
const ROTATION_MINUSCULE = [
  [1e-8, 0, 0],
  [0, -1e-8, 0],
  [0, 0, -1e-8],
];
const ZERO = [0, 0, 0];
const NORMALE_GARDE = [0.6, -0.8, 0];

/** A singular case: its pose, its local normal, and the world normal the convention requires. */
const garde = (nom: string, colonnes: number[][], normale: number[], vraie: number[]) => ({
  nom,
  world: pose(colonnes),
  normale,
  vraie,
  degenere: true,
  effondree: vraie === ZERO,
  ...MATIERE,
});

/**
 * SINGULAR POSES THAT KEEP A FACE (rank 2). The primitive is crushed onto a PLANE, its faces
 * keep a non-zero area there, and the world normal is that of the transformed face — the
 * cross product of its transformed edges. Both expectations are computed by hand here,
 * without going through the kernel.
 *
 *  — `scale (1,1,0) then 90° around Y` is THE audit counter-example. Ry(90°) sends x onto
 *    −z and z onto x; composed with diag(1, 1, 0) its columns are (0,0,−1), (0,1,0), (0,0,0).
 *    The local triangle (0,0,0), (1,0,0), (0,1,0) becomes (0,0,0), (0,0,−1), (0,1,0): world
 *    edges (0,0,−1) and (0,1,0), cross product (1, 0, 0), area 0.5 — the face is perfectly
 *    visible and perfectly oriented. Its LOCAL normal is (0,0,1); the expected world normal
 *    is therefore +X. The old fallback returned +Z, the unrotated local normal, i.e. lighting
 *    of about 0.09 per channel instead of 0.8; the CPU path returned the zero vector.
 *  — `null column` crushes the y axis: columns (1e-8,0,0), (0,0,0), (0,0,−1e-8). The arrival
 *    plane is XZ, of normal ±Y. Local normal (0.6, −0.8, 0) is that of edges (0.8; 0.6; 0)
 *    and (0,0,1); transformed they are (8e-9, 0, 0) and (0, 0, −1e-8), and their cross
 *    product is (0, 8e-17, 0): +Y. The local normal's −y component does not survive — on a
 *    flattened face every vertex normal falls onto the face normal, smoothing vanishes with
 *    the volume, and it is the EDGES' orientation that decides the side.
 */
export const APLATIES = [
  garde(
    'flattened face: scale (1,1,0) then 90° around Y',
    [[0, 0, -1], [0, 1, 0], ZERO],
    [0, 0, 1],
    [1, 0, 0],
  ),
  garde(
    'null column (rank 2, the face keeps its area)',
    [ROTATION_MINUSCULE[0], ZERO, ROTATION_MINUSCULE[2]],
    NORMALE_GARDE,
    [0, 1, 0],
  ),
];

/**
 * POSES THAT COLLAPSE THE FACE: no more world area, hence no normal, hence no lighting.
 * The expectation is the ZERO vector — finite, never a NaN that would leak into neighbouring
 * pixels through screen derivatives, and never the local normal of a surface that no longer
 * exists.
 *
 *  — `null 3×3` and `rank 1` collapse the primitive onto a point or a line: the adjugate is
 *    zero by itself there, the three columns being parallel, all its cross products are.
 *  — `infinite coefficient` and `NaN coefficient` are not poses: the sum of absolute values
 *    is not finite, the normalised 3×3 is worthless, and the kernel zeroes its adjugate.
 *    Those two should never reach the shader — `assertFiniteTransform` rejects them at load
 *    and at `setTransform` — but the kernel does not assume that.
 */
export const EFFONDREES = [
  garde('null 3×3 (null sum)', [ZERO, ZERO, ZERO], NORMALE_GARDE, ZERO),
  garde(
    'rank 1 (all three columns on one axis)',
    [
      [1, 0, 0],
      [2, 0, 0],
      [-1, 0, 0],
    ],
    NORMALE_GARDE,
    ZERO,
  ),
  garde(
    'infinite coefficient',
    [[Infinity, 0, 0], ROTATION_MINUSCULE[1], ROTATION_MINUSCULE[2]],
    NORMALE_GARDE,
    ZERO,
  ),
  garde(
    'NaN coefficient',
    [[NaN, 0, 0], ROTATION_MINUSCULE[1], ROTATION_MINUSCULE[2]],
    NORMALE_GARDE,
    ZERO,
  ),
];

/** All singular cases, flattened then collapsed: the list the proofs run on GPU. */
export const GARDES = [...APLATIES, ...EFFONDREES];

/**
 * Witness that the guard is not greedy: tiny but regular, it must rotate.
 *
 * `ROTATION_MINUSCULE` is diag(1e-8, −1e-8, −1e-8): a half-turn around x, scale 1e-8,
 * determinant +1e-24. Its inverse-transpose is diag(1e8, −1e8, −1e8), and the local
 * normal [0.6, −0.8, 0] yields [6e7, 8e7, 0], i.e. [0.6, 0.8, 0] once unit. The half-turn
 * flips y and z; it does not flip x. The expectation carried here used to be [−0.6, −0.8, 0],
 * the OPPOSITE: the criterion of the time took the absolute value of the dot product,
 * confused N and −N, and accepted that error at zero degrees. `verdictNormale`'s oriented
 * criterion refuses it.
 */
export const REGULIERE_MINUSCULE = {
  nom: 'scale-1e-8 rotation (regular)',
  world: pose(ROTATION_MINUSCULE),
  normale: NORMALE_GARDE,
  vraie: [0.6, 0.8, 0],
  degenere: false,
  effondree: false,
  ...MATIERE,
};
