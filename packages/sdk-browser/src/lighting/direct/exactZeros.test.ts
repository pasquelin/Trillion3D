// Two terms a light's loop skips where develop added an exact zero, which leaves every sum as it
// is: a thin transmission on a surface that has none (`declaredLightWgsl`, develop's `0 · x`, a zero
// of either sign), and the standard lobes of a light the surface faces away from
// (`standardLighting`, N·L = 0: finite D, Vis and F times direct = light.w · 0). The shipped loop runs
// in f32 (`shaderRun`, `shaderRunF32.fixture.ts`) against develop's — the same text with the skip
// undone —, in the four programs (shadow code or not, rectangle code or not) and the three surface
// models, on random lamp sets around a random normal (half of them behind it), with no thin
// transmission, a signed-zero one and a real one lit from behind: the sums are the same numbers,
// bit for bit, each skip alone and both.
import test from 'node:test';
import assert from 'node:assert/strict';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { F32_SCOPE } from '../shaderRunF32.fixture.ts';
import { wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { MODEL_FLAG } from '../../scene/surfaceModel.ts';
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts';
import { directLightingWgsl } from './lightingWgsl.ts';

type Sum = (...args: unknown[]) => number[];
const GUARDED =
  /var transmitted=vec3f\(0\.0\);\n if\(any\(thinSubsurface!=vec3f\(0\.0\)\)\)\{transmitted=(thinSubsurface\*thinTransmission\([^;]*\));\}/;
const EARLY = /\n if\(NdotL==0\.0\)\{return vec3f\(0\.0\);\}/;
/** Develop's text: the thin skip, the early zero, or both undone. */
const UNDO = {
  thin: (text: string) => text.replace(GUARDED, 'let transmitted=$1;'),
  facing: (text: string) => text.replace(EARLY, ''),
  both: (text: string) => text.replace(GUARDED, 'let transmitted=$1;').replace(EARLY, ''),
};
const NAMES = [
  'sliceLighting',
  'declaredLight',
  'directIncidence',
  'rangeWindow',
  'isSun',
  'isSunKind',
  'isRect',
  'modelLight',
  'thinTransmission',
  // Every function of the standard lobe's text.
  ...[...STANDARD_LIGHTING_WGSL.matchAll(/fn (\w+)\(/g)].map(([, name]) => name),
];

test('the skipped thin transmission and back-facing lobes keep every sum, bit for bit, in f32', () => {
  const r = random(1564),
    u = (lo: number, hi: number) => lo + (hi - lo) * r();
  let lit = 0;
  for (const shadowed of [false, true])
    for (const rects of [false, true]) {
      const shipped = `${directLightingWgsl(false, shadowed, rects)}${STANDARD_LIGHTING_WGSL}`;
      assert.match(shipped, GUARDED);
      assert.match(shipped, EARLY);
      const K = wgslConstants(shipped);
      for (let round = 0; round < 150; round++) {
        const count = 1 + Math.floor(u(0, 12));
        const P = [u(-5, 5), u(-1, 3), u(-5, 5)];
        const items = [...Array(count).keys()].map((rank) => ({
          positionRange: [P[0] + u(-4, 4), P[1] + u(-4, 4), P[2] + u(-4, 4), u(0.1, 8)],
          colorIntensity: [u(0, 1), u(0, 1), u(0, 1), u(0, 20)],
          directionCone: [0, -1, 0, rank % 3 ? -1 : 0.7],
          params: [rank % 3 ? 0 : K.KIND_SPOT, -1, 0, rank % 3 ? 0 : 0.9],
          shape: [0, 0, 0, 0],
        }));
        const n = [u(-1, 1), u(-1, 1), u(-1, 1)],
          N = n.map((v) => v / (Math.hypot(...n) || 1));
        const thin = [
          [0, 0, 0],
          [-0, 0, -0],
          [u(0, 1), 0, u(0, 1)],
        ][round % 3];
        const scope = {
          ...F32_SCOPE,
          ...K,
          directLights: { count, items },
          tileLights: [],
          thinSubsurface: thin,
          surfaceModel: [2, MODEL_FLAG.diffuse, MODEL_FLAG.toon][Math.floor(round / 3) % 3],
          shadowReceiverOffset: [0, 0, 0],
          shadowReceiverPlane: [0, 0, 0],
          shadowBiasNormal: (normal: number[]) => normal,
          shadowTransmission: [1, 1, 1],
          shadowFactor: () => 1,
        };
        const surface = [[u(0, 1), u(0, 1), u(0, 1)], u(0, 1), u(0.06, 1), N, [0.6, 0.8, 0], P, 1];
        const at = (source: string) =>
          shaderRun<{ sliceLighting: Sum }>(source, NAMES, scope).sliceLighting(...surface, [
            K.TILE_NO_SLICE,
            count,
          ]);
        const ours = at(shipped);
        for (const [undone, undo] of Object.entries(UNDO)) {
          const theirs = at(undo(shipped));
          assert.ok(
            ours.every((v, i) => Object.is(v, theirs[i])),
            `${undone}, ${shadowed} ${rects} round ${round}: ${ours} against ${theirs}`,
          );
        }
        lit += +ours.some((v) => v > 0);
      }
    }
  assert.ok(lit > 400, `${lit} of 600 sums lit`);
});
