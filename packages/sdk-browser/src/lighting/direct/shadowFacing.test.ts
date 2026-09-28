// #685: a lit point facing away from its light gets an exact zero whatever the shadow, so its
// filter's taps are skipped — never its page reads, which ask the scheduler for their pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRECT_LIGHTING_WGSL, declaredLightingWgsl } from './lightingWgsl.ts';
import { directShadowWgsl } from './shadowWgsl.ts';
import { SHADOW_FACTOR_WGSL } from './shadowFactorWgsl.ts';
import { MODEL_FLAG } from '../../scene/surfaceModel.ts';
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts';
import { functionText } from '../../bounce/wgslBody.fixture.ts';
import { dotVector3 } from '../../../../sdk-core/src/math/primitives/vector.ts';

type V = number[];
const dot = (a: V, b: V) => dotVector3(a, b);
const normalize = (a: V) => a.map((c) => c / Math.sqrt(dot(a, a)));
const N = [0, 0, 1];

/** The shipped `declaredLight` of `source` under `surfaceModel`, lighting N from `L`: the `taps`
 *  it hands the shadow read, and its result. The shadow read answers zero without taps, as
 *  `shadowPcf` does once its pages are asked for. */
function declared(source: string, surfaceModel: number, L: V) {
  const taps: boolean[] = [];
  const scope = {
    surfaceModel,
    dot,
    normalize,
    i32: Math.trunc,
    vec3f: (x: number) => [x, x, x],
    vec4f: (xyz: V, w: number) => [...xyz, w],
    isRect: () => false,
    directIncidence: () => ({ xyz: L, w: 1 }),
    shadowFactor: (_s: number, _l: object, _P: V, _N: V, _L: V, pass: boolean) => {
      taps.push(pass);
      return pass ? 0.5 : 0;
    },
    modelLight: () => 1,
    standardLighting: () => 1,
  };
  type Declared = { declaredLight: (...args: unknown[]) => unknown };
  const { declaredLight } = shaderFunctions<Declared>(source, ['declaredLight'], scope);
  const light = { params: { y: 0 }, colorIntensity: { w: 1, rgb: 1 } };
  return { taps, result: declaredLight(light, 0, 0, 0.5, N, N, [0, 0, 0], 1) };
}

test('a point facing away skips the taps; a toon or a facing one filters (#685)', () => {
  const standard = 0;
  const { diffuse, toon } = MODEL_FLAG;
  for (const source of [DIRECT_LIGHTING_WGSL, declaredLightingWgsl(11, 18, 26)])
    for (const [model, L, filters] of [
      [standard, [0, 0.6, 0.8], true],
      [diffuse, [0, 0.6, 0.8], true],
      [toon, [0, 0.6, 0.8], true],
      [standard, [0, 0.6, -0.8], false],
      [diffuse, [0, 0.6, -0.8], false],
      [standard, [1, 0, 0], false],
      [diffuse, [1, 0, 0], false],
      // Toon's bands light a point facing away: its shadow is filtered in full.
      [toon, [0, 0.6, -0.8], true],
    ] as Array<[number, V, boolean]>) {
      const { taps, result } = declared(source, model, L);
      assert.deepEqual(taps, [filters], `model ${model}, L ${L}`);
      if (!filters) assert.deepEqual(result, [0, 0, 0], 'the exact zero of before');
    }
});

test('the facing test is the lighting’s own cosine clamp', () => {
  // Standard scales every term by `max(dot(N,normalize(L)),0)`, diffuse by `max(dot(N,L),0)`: at
  // zero both are zero whatever the shade. `max(c,0)>0` is `c>0`, NaN included.
  const cosines = `select(dot(N,normalize(incidence.xyz)),dot(N,incidence.xyz),surfaceModel==${MODEL_FLAG.diffuse}u)>0.0;`;
  assert.ok(DIRECT_LIGHTING_WGSL.includes(cosines));
});

test('without taps the filter asks for the same pages, then reads none (#685)', () => {
  const pcf = functionText(directShadowWgsl(8, 14, 18), 'shadowPcf');
  const guard = pcf.indexOf('if(!taps){return 0.0;}');
  assert.ok(guard > 0);
  assert.equal(pcf.split('taps').length - 1, 2, 'the parameter and its one guard');
  // Every neighbour word — read and asked for — comes before it, every comparison after it.
  assert.equal(pcf.split('shadowNeighbour(').length - 1, 3);
  assert.ok(pcf.lastIndexOf('shadowNeighbour(') < guard);
  for (const read of ['shadowSample(', 'shadowCompare(', 'shadowThroughLit('])
    assert.ok(pcf.indexOf(read) > guard, read);
  // The walk of the levels and the far ray never look at it: each function takes it last and only
  // hands it on, as the last argument of its calls.
  for (const [name, calls] of [
    ['shadowFactor', 2],
    // A page of the sun's current depth range, and one of an older range (#991).
    ['sunShadowFactor', 2],
    ['lampShadowFactor', 1],
  ] as const) {
    const code = functionText(SHADOW_FACTOR_WGSL, name).replace(/\/\/.*$/gm, '');
    assert.ok(code.includes(',taps:bool)->f32{'), name);
    assert.equal(code.match(/,taps\);/g)?.length, calls, name);
    assert.equal(code.match(/\btaps\b/g)?.length, 1 + calls, name);
  }
});
