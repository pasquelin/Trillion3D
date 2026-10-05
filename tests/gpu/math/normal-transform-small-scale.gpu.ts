// Defect 9 (`NORMAL_TRANSFORM_WGSL`, `standardLighting.ts`): the `abs(det)<1e-20` guard bore on the
// RAW determinant of the world 3×3. A uniform-scale rotation s has determinant ±s³: from s ≲ 2.15e-7
// the lighting normal stayed LOCAL, unrotated — the surface lit as if it had not turned. Defect 6 in
// another file, fixed by sharing one text (`inverseTransposeWgsl.ts`) instead of writing a variant.
//
// The engine's lighting texts run on Dawn (`lightingNormalGpu.ts`); the truth is the graph's f64
// normal matrix, and the luminance gap is the same BRDF's, lit on the GPU with the rendered normal
// and with the true one. The form from before the fix is rebuilt by `substitutionBefore.ts`.
//
//   node bench/dawn/proofs.ts tests/gpu/math/normal-transform-small-scale.gpu.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { NORMAL_TRANSFORM_WGSL } from '../../../packages/sdk-browser/src/lighting/standardLighting.ts';
import {
  LIT_MATERIAL,
  campaign,
  lightingCase,
  luminance,
  normalGap,
} from './lightingNormalCases.ts';
import { lightNormals } from './lightingNormalGpu.ts';
import { inverseTransposeBeforeIn } from './substitutionBefore.ts';

test('the lighting normal follows a quarter turn at every scale, about the threshold too', async () => {
  const cases = [1e3, 1, 1e-3, 1e-6, 2.155e-7, 2.154e-7, 1e-7, 1e-8, 1e-12, 1e-16].flatMap((s) =>
    (['uniform', 'anisotropic'] as const).map((kind) =>
      lightingCase({
        s,
        kind,
        axis: [0, 1, 0],
        angleDeg: 90,
        normal: [0, 0, 1],
        ...LIT_MATERIAL,
      }),
    ),
  );
  // A quarter turn about Y sends the local normal (0,0,1) to (1,0,0): the truth must have turned,
  // or the case proves nothing.
  for (const lit of cases) assert.ok(Math.abs(lit.truth[0]) > 0.99, `${lit.name}: no turn`);
  const { rows } = await lightNormals(cases);
  cases.forEach((lit, i) => {
    const gap = normalGap(lit, rows[i]);
    assert.ok(gap.verdict.ok, `${lit.name}: ${gap.verdict.reason}`);
    assert.ok(
      gap.luminanceGap < 1e-4,
      `${lit.name}: luminance ${gap.renderedLuminance} instead of ${gap.truthLuminance}`,
    );
  });
});

test('the form before the fix lost the rotation at small scales; the shipped text never does', async () => {
  // The previous text put back into the shipped one, with the same guard as defect 6:
  // `substitutionBefore.ts` fails naming what is missing if the block is gone, doubled or pasted
  // crookedly. A merely "different" text would prove nothing.
  const before = inverseTransposeBeforeIn(NORMAL_TRANSFORM_WGSL, 'NORMAL_TRANSFORM_WGSL');
  const cases = campaign();
  const [then, now] = await Promise.all([
    lightNormals(cases, { transform: before }),
    lightNormals(cases),
  ]);
  const dropouts = (rows: typeof now.rows) =>
    cases.filter((lit, i) => !normalGap(lit, rows[i]).verdict.ok);
  assert.deepEqual(
    dropouts(now.rows).map((lit) => lit.name),
    [],
    'the shipped text follows the rotation at every scale',
  );
  assert.ok(dropouts(then.rows).length > 0, 'defect 9 no longer reproduces: review the cases');
  // Outside the threshold band (s ≥ 1e-6) the fix moved no lit colour: the arithmetic touches every
  // shaded pixel.
  cases.forEach((lit, i) => {
    if (lit.s < 1e-6) return;
    const [a, b] = [luminance(then.rows[i].litRendered), luminance(now.rows[i].litRendered)];
    assert.ok(
      Math.abs(a - b) / Math.max(a, 1e-6) < 1e-5,
      `${lit.name}: lighting moved, ${a} → ${b}`,
    );
  });
});
