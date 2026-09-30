import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { CATMULL_ROM_WGSL, CURRENT_SHARE_WGSL } from './historyWgsl.ts';
import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { createTaaFrameState } from './frameState.ts';
import { writeTaaView } from './view.ts';
import type { EngineCamera } from '../camera/world.ts';

const REACTIVE_MAX = 0.9;

type Share = { currentShare: (a: number, reach: number, rho: number, fresh: boolean) => number };
const { currentShare } = shaderRun<Share>(CURRENT_SHARE_WGSL, ['currentShare'], {});
const MOVING = 1 / 8;

test('a pixel with no history takes the current sample whole', () => {
  for (const [reach, rho] of [
    [1, 0],
    [0, 0],
    [0.3, 0.95],
  ])
    assert.equal(currentShare(MOVING, reach, rho, true), 1, `reach ${reach}, reactive ${rho}`);
});

test('a reactive value raises the current share to at least itself, never above 0.9', () => {
  assert.equal(REACTIVE_MAX, 0.9);
  assert.equal(currentShare(MOVING, 1, 0, false), MOVING, 'no reactive: today’s share');
  assert.equal(currentShare(MOVING, 1, 0.05, false), MOVING, 'below the share: nothing');
  for (const rho of [0.3, 0.5, 0.9]) assert.equal(currentShare(MOVING, 1, rho, false), rho);
  for (const rho of [0.95, 1]) assert.equal(currentShare(MOVING, 1, rho, false), REACTIVE_MAX);
  assert.equal(currentShare(MOVING, 0, 0.4, false), 0.4, 'even for a far sample');
});

test('a sample far from its display pixel lowers its weight', () => {
  const shares = [1, 0.6, 0.2, 0].map((reach) => currentShare(MOVING, reach, 0, false));
  assert.deepEqual(shares, [MOVING, MOVING * 0.6, MOVING * 0.2, 0]);
});

/** A history of 8×8 texels read bilinearly, clamped to its edge: a step from 0 to 1 at column 4,
 *  every row the same. */
const step = (x: number) => (x < 4 ? 0 : 1);
function bilinear([u]: number[]) {
  const x = Math.min(Math.max(u * 8 - 0.5, 0), 7);
  const x0 = Math.floor(x),
    fx = x - x0;
  const value = step(x0) * (1 - fx) + step(Math.min(x0 + 1, 7)) * fx;
  return [value, value, value, 1];
}
/** A row's centre: the vertical taps land on it. */
const ROW = 4.5 / 8;
type Read = { historyCatmullRom: (uv: number[]) => number[] };
const { historyCatmullRom } = shaderRun<Read>(CATMULL_ROM_WGSL, ['historyCatmullRom'], {
  view: { viewport: [8, 8, 1 / 8, 1 / 8] },
  history: null,
  historySampler: null,
  textureSampleLevel: (_: null, __: null, uv: number[]) => bilinear(uv),
});

test('the moving history keeps its sharpness where bilinear softens it', () => {
  // At a texel centre both read the texel itself.
  for (const x of [2, 3, 4, 5]) {
    const uv = [(x + 0.5) / 8, ROW];
    assert.ok(Math.abs(historyCatmullRom(uv)[0] - step(x)) < 1e-9, `texel ${x}`);
  }
  // A quarter of a pixel past the last dark texel: bilinear lets a quarter of the edge in,
  // Catmull-Rom about a fifth — the step stays a step instead of spreading by a fraction each image.
  const uv = [3.75 / 8, ROW],
    soft = bilinear(uv)[0],
    sharp = historyCatmullRom(uv)[0];
  assert.equal(soft, 0.25);
  assert.ok(Math.abs(sharp - 0.203125) < 1e-9, `Catmull-Rom ${sharp}`);
  // Never below zero, whatever its negative lobes.
  assert.ok(historyCatmullRom([4.2 / 8, 0.3]).every((c) => c >= 0 && c <= 1.1));
});

test('the uniform tells the resolve whether the image moves: at rest, today’s resolve', () => {
  const { device, writes } = fakeDevice(),
    state = createTaaFrameState(),
    cam = { viewProjection: IDENTITY_MATRIX4, eye: [0, 0, 0] } as unknown as EngineCamera;
  const moves = (stillFrames: number) => {
    state.stillFrames = stillFrames;
    writeTaaView(device, {} as GPUBuffer, state, cam, [8, 8], [16, 16], false);
    return (writes.at(-1)!.data as Float32Array)[58];
  };
  assert.deepEqual([0, 1, 5].map(moves), [1, 0, 0]);
});
