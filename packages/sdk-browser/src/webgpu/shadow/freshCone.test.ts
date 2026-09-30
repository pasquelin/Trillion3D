// #1275: a lamp page's cone is composed once (`coneModel.ts`): the GPU's pages run its WGSL, the
// host's `writeConeVolume` its numbers, and both answer the same over seeded faces and pages, a
// field past a quarter turn included.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONE } from '../../../../sdk-core/src/scene/light-shadow/coneModel.ts';
import { CONE_MODEL_WGSL } from '../../../../sdk-core/src/scene/light-shadow/coneModelWgsl.ts';
import { mulberry32 } from '../../../../../site/examples/kit/random.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { shadowFreshWgsl } from './freshWgsl.ts';

const SHADOW_FRESH_WGSL = shadowFreshWgsl();

type Cone = (...args: unknown[]) => number & number[];
const r = mulberry32(1275);
const unit = () => {
  const v = [r() - 0.5, r() - 0.5, r() - 0.5],
    n = Math.hypot(...v);
  return v.map((c) => c / n);
};

test("a lamp page's cone is the same composed by the GPU and by the host, a wide field too", () => {
  const gpu = shaderRun<Record<string, Cone>>(
    CONE_MODEL_WGSL,
    ['shadowConeAxis', 'shadowConeSpread'],
    {},
  );
  const close = (a: number, b: number, what: string) =>
    assert.ok(Math.abs(a - b) <= 1e-12, `${what}: ${a} ≠ ${b}`);
  for (let k = 0; k < 2000; k++) {
    const face = [unit(), unit(), unit()] as const,
      halfFov = k % 4 ? r() * 1.5 : Math.PI / 2 + r(),
      at = [...face, Math.tan(halfFov), halfFov] as const,
      [u0, u1, v0, v1] = [r(), r(), r(), r()].map((c) => c * 2 - 1).sort((a, b) => a - b);
    const axis = CONE.shadowConeAxis(...at, u0, u1, v0, v1);
    gpu.shadowConeAxis(...at, u0, u1, v0, v1).forEach((c, i) => close(c, axis[i], `axis ${k}`));
    close(
      gpu.shadowConeSpread(...at, axis, u0, u1, v0, v1),
      CONE.shadowConeSpread(...at, axis, u0, u1, v0, v1),
      `spread ${k}`,
    );
  }
  assert.equal(SHADOW_FRESH_WGSL.split(CONE_MODEL_WGSL).length, 2, 'the GPU pages hold it once');
});
