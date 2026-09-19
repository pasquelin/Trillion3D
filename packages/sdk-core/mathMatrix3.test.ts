import test from 'node:test';
import assert from 'node:assert/strict';
import { normalMatrix3 } from './mathMatrix3.ts';
import { dotVector3 } from './mathVector.ts';

test('normalMatrix3: affine identity block yields the 3×3 identity', () => {
  const m = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]);
  const out = normalMatrix3(new Float64Array(9), m);
  assert.deepEqual([...out], [1, 0, 0, 0, 1, 0, 0, 0, 1]);
});

test('normalMatrix3: non-uniform scale, reciprocal diagonal term by term', () => {
  const m = Float64Array.from([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 5, 0, 1, 2, 3, 1]);
  const out = normalMatrix3(new Float64Array(9), m);
  assert.deepEqual([out[0], out[4], out[8]], [0.5, 1 / 3, 0.2]);
  assert.deepEqual([out[1], out[2], out[3], out[5], out[6], out[7]], [0, 0, 0, 0, 0, 0]);
});

test('normalMatrix3: rank-2 singular block yields the adjugate, the arrival-plane normal', () => {
  // Column 1 = 2 × column 0: singular block, but rank 2. Columns (1,0,0) and (0,0,1)
  // span the XZ plane: the primitive is FLATTENED there, its faces keep an area, and their
  // world normal is ±Y. The adjugate writes it column by column — b × c = (0, −2, 0),
  // c × a = (0, 1, 0), a × b = 0 — and any local normal outside the kernel lands there once
  // normalised. The reference returned nine zeros, hence a surface with no normal at all.
  const m = Float64Array.from([1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const out = normalMatrix3(new Float64Array(9).fill(9), m);
  assert.deepEqual([...out], [0, -2, 0, 0, 1, 0, 0, 0, 0]);
});

test('normalMatrix3: rank 2, several distinct vertex normals all land on the face normal', () => {
  // THE audit counter-example: local triangle (0,0,0), (1,0,0), (0,1,0), scale (1,1,0) then
  // 90° around Y. Ry(90°) sends x onto −z and z onto x; composed with diag(1,1,0), its columns
  // are (0,0,−1), (0,1,0), (0,0,0) — the primitive is flattened onto the world XY plane, transformed
  // edges (0,0,−1) and (0,1,0), cross product (1,0,0): the FACE normal is +X.
  const m = Float64Array.from([0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  const n = normalMatrix3(new Float64Array(9), m);
  // The rank-1 adjugate keeps only the z component of the local normal (columns 0 and 1
  // zero): three different vertex normals, but with a positive z component as on a
  // face that has not flipped, must all land on +X once unit — the flattened
  // face has only one normal left, the face one, and per-vertex smoothing disappears.
  const normalesLocales: Array<[number, number, number]> = [
    [0, 0, 1],
    [0.5, 0.3, 0.8],
    [-0.2, 0.9, 0.4],
  ];
  for (const [x, y, z] of normalesLocales) {
    const rendue: [number, number, number] = [
      n[0] * x + n[3] * y + n[6] * z,
      n[1] * x + n[4] * y + n[7] * z,
      n[2] * x + n[5] * y + n[8] * z,
    ];
    const norme = Math.hypot(...rendue);
    assert.ok(norme > 0, `vertex normal (${x},${y},${z}): yielded zero, ${rendue}`);
    assert.deepEqual(
      [rendue[0] / norme, rendue[1] / norme, rendue[2] / norme],
      [1, 0, 0],
      `vertex normal (${x},${y},${z}): ${rendue}, expected face normal +X`,
    );
  }
});

test('normalMatrix3: block collapsed onto a line yields the zero matrix, for lack of a face', () => {
  // All three columns on the x axis: the primitive is crushed onto a line, no face keeps
  // an area there, and the three cross products of parallel columns are zero by themselves.
  const m = Float64Array.from([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 1]);
  const out = normalMatrix3(new Float64Array(9).fill(9), m);
  assert.deepEqual([...out], new Array(9).fill(0));
});

test('normalMatrix3: a non-zero raw determinant of degenerate shape yields the adjugate, like the WGSL kernel', () => {
  // The engine's single rule (`mathSingular.ts`) judges the NORMALISED determinant. Here the raw
  // determinant is 5e-324 — non-zero, so the old `det === 0` test let it through — but its inverse
  // is infinity: every term came out infinite or NaN. Normalised, it falls under the threshold, so
  // the adjugate goes as-is and the arrival-plane normal survives. The GPU already decided
  // this way; the CPU decides like it.
  const m = Float64Array.from([1, 0, 0, 0, 1, 5e-324, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const out = normalMatrix3(new Float64Array(9).fill(9), m);
  assert.deepEqual([...out], [5e-324, -1, 0, 0, 1, 0, 0, 0, 5e-324]);
  // The local +Z normal stays carried onto +Z: the arrival plane is recovered.
  const z: [number, number, number] = [out[6], out[7], out[8]];
  assert.ok(z[2] > 0 && z[0] === 0 && z[1] === 0, `+Z normal: ${z}`);
});

test('normalMatrix3: a non-finite scale yields nine zeros, like the WGSL kernel', () => {
  // Zero, infinite or NaN scale: the normalised 3×3 is worthless, the WGSL kernel then replaces its
  // adjugate with zero, and the CPU does the same. This is an ASSUMED discrepancy with the
  // reference library, which propagated NaNs; a non-finite pose is rejected at engine entry
  // (`hostWorldMatrices.ts`), and nothing non-finite must go back into lighting.
  for (const m of [
    Float64Array.from([NaN, 0, 0, 0, 0, -0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    Float64Array.from([Infinity, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  ])
    assert.deepEqual([...normalMatrix3(new Float64Array(9).fill(9), m)], new Array(9).fill(0));
});

test('normalMatrix3: preserves normal/tangent perpendicularity under shear', () => {
  // Shear in x along y: a normal and a tangent perpendicular in object space
  // must stay so in transformed space once the normal is carried by the normal matrix.
  const m = Float64Array.from([1, 0, 0, 0, 0.7, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const normaleObjet: [number, number, number] = [0, 1, 0];
  const tangenteObjet: [number, number, number] = [1, 0, 0];
  assert.equal(dotVector3(normaleObjet, tangenteObjet), 0);
  const n = normalMatrix3(new Float64Array(9), m);
  const normaleMonde: [number, number, number] = [
    n[0] * normaleObjet[0] + n[3] * normaleObjet[1] + n[6] * normaleObjet[2],
    n[1] * normaleObjet[0] + n[4] * normaleObjet[1] + n[7] * normaleObjet[2],
    n[2] * normaleObjet[0] + n[5] * normaleObjet[1] + n[8] * normaleObjet[2],
  ];
  const tangenteMonde: [number, number, number] = [
    m[0] * tangenteObjet[0] + m[4] * tangenteObjet[1] + m[8] * tangenteObjet[2],
    m[1] * tangenteObjet[0] + m[5] * tangenteObjet[1] + m[9] * tangenteObjet[2],
    m[2] * tangenteObjet[0] + m[6] * tangenteObjet[1] + m[10] * tangenteObjet[2],
  ];
  assert.ok(Math.abs(dotVector3(normaleMonde, tangenteMonde)) < 1e-12);
});
