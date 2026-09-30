import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderFunctions } from '../texture/shaderRule.fixture.ts';
import { Mat } from '../texture/shaderRun.fixture.ts';
import { mulberry32 } from '../../../../site/examples/kit/random.ts';
import { LANCZOS2_WGSL, taaUpscaleShader } from './upscaleWgsl.ts';
import { TAA_SHADER } from './shaderWgsl.ts';
import { STILL_AVERAGE_WGSL, taaHistoryBlend } from './historyWgsl.ts';
import { kernel, owed, upscaleRun, type UpscaleFrame } from './upscaleRun.fixture.ts';

type Kernel = { lanczos2: (x: number) => number };
const near = (a: number[], b: number[], what: string) =>
  a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-9, `${what}: ${a} against ${b}`));

test('the current image is resampled with Lanczos-2: one at its sample, zero at each integer', () => {
  const { lanczos2 } = shaderFunctions<Kernel>(LANCZOS2_WGSL, ['lanczos2'], { sin: Math.sin });
  assert.equal(lanczos2(0), 1);
  for (const x of [1, 2, 3]) assert.ok(Math.abs(lanczos2(x)) < 1e-6, `zero at ${x}`);
  assert.ok(lanczos2(0.5) > 0 && lanczos2(1.5) < 0, 'its negative lobe, which deringing clamps');
  assert.ok(Math.abs(lanczos2(0.7) - kernel(0.7)) < 1e-6);
});

const random = mulberry32(816);
const noise = Array.from({ length: 64 }, () => [random(), random(), random(), 1]);
const noisy = (x: number, y: number) => noise[y * 8 + x];

test('a moving image weighs each texel by Lanczos-2 of where it was sampled, at 0.5 and 0.67', () => {
  for (const [display, jitter] of [
    [16, [0, 0]],
    [16, [0.3, -0.2]],
    [12, [-0.45, 0.1]],
    [12, [0.2, 0.4]],
  ] as const) {
    const frame: UpscaleFrame = {
      render: [8, 8],
      display: [display, display],
      jitter: [...jitter],
      color: noisy,
      moving: true,
    };
    const resolve = upscaleRun(frame);
    for (let y = 0; y < display; y++)
      for (let x = 0; x < display; x++)
        near(
          resolve(x, y).color,
          owed(frame, x, y),
          `${display} px, jitter ${jitter}, pixel ${x},${y}`,
        );
  }
  // Normalised: a flat image, and a history of that same image, stay that image.
  const flat = [0.3, 0.6, 0.1, 1];
  const resolve = upscaleRun({
    render: [8, 8],
    display: [12, 12],
    jitter: [0.4, -0.3],
    color: () => flat,
    history: () => flat,
  });
  for (const [x, y] of [
    [0, 0],
    [5, 7],
    [11, 11],
  ])
    near(resolve(x, y).color, flat, 'flat');
});

test('the sample is clamped to its 2×2 nearest texels, where Lanczos-2 rings', () => {
  // A hard edge: the negative lobes overshoot either side of it, the clamp takes the overshoot off.
  const edge: UpscaleFrame = {
    render: [8, 8],
    display: [16, 16],
    jitter: [0.1, 0],
    color: (x) => (x < 4 ? [0, 0, 0, 1] : [1, 1, 1, 1]),
    moving: true,
  };
  const resolve = upscaleRun(edge);
  let rang = 0;
  for (let x = 0; x < 16; x++) {
    const raw = owed(edge, x, 5, 'none')[0],
      [color] = resolve(x, 5).color;
    assert.ok(color >= 0 && color <= 1, `pixel ${x}: ${color}`);
    if (raw >= 0 && raw <= 1) continue;
    rang++;
    assert.equal(color, raw < 0 ? 0 : 1);
  }
  assert.ok(rang > 0, 'the edge rings without the clamp');
  // A bright texel of the 3×3 outside the 2×2 widens nothing: display pixel 2 lies at 0.75,
  // between texels 0 and 1; texel 2 weighs in the sum, not in the bounds.
  const spike: UpscaleFrame = {
    render: [8, 8],
    display: [16, 16],
    color: (x) => (x === 2 ? [5, 5, 5, 1] : [0.5, 0.5, 0.5, 1]),
    moving: true,
  };
  assert.notEqual(owed(spike, 2, 2, 'none')[0], 0.5);
  near(upscaleRun(spike)(2, 2).color, [0.5, 0.5, 0.5, 1], 'the 2×2 bounds');
});

/** Clip-space translation by `tx`, and the shear `x += z` that shows the depth reprojected. */
const moveX = (tx: number) => new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, 0, 0, 1]);
const DEPTH_TO_X = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1]);

test('the nearest surface of the 3×3 gives the depth and the motion the history is read with', () => {
  // Display pixel 5,5 of 16 lies at 2.25 in the 8×8 render grid: its taps span texels 1 to 3.
  const at = (fx: number, fy: number, depth: number): UpscaleFrame => ({
    render: [8, 8],
    display: [16, 16],
    color: noisy,
    depth: (x, y) => (x === fx && y === fy ? depth : 0.1),
    id: (x, y) => (x === fx && y === fy ? 1 << 8 : 0),
    motion: moveX(0.25),
    prevViewProj: DEPTH_TO_X,
    history: () => [0, 0, 0, 1],
  });
  const ndc = (5.5 / 16) * 2 - 1,
    uv = (x: number) => [x * 0.5 + 0.5, 0.5 - -ndc * 0.5];
  // A near texel on the diagonal: its depth, 0.5, and its placement's motion, 0.25.
  near(upscaleRun(at(3, 1, 0.5))(5, 5).reads[0], uv(ndc + 0.5 + 0.25), 'dilated');
  // Farther than the rest, or outside the 3×3: the background's depth, and no motion.
  near(upscaleRun(at(3, 1, 0.05))(5, 5).reads[0], uv(ndc + 0.1), 'farther');
  near(upscaleRun(at(0, 0, 0.5))(5, 5).reads[0], uv(ndc + 0.1), 'outside');
});

test('the history is read from the display pixel centre, whatever the jitter', () => {
  for (const jitter of [
    [0, 0],
    [0.45, -0.3],
    [-0.2, 0.25],
  ] as [number, number][]) {
    const resolve = upscaleRun({
      render: [8, 8],
      display: [12, 12],
      jitter,
      color: noisy,
      history: () => [0, 0, 0, 1],
    });
    for (const [x, y] of [
      [0, 0],
      [7, 3],
      [11, 10],
    ])
      near(resolve(x, y).reads[0], [(x + 0.5) / 12, (y + 0.5) / 12], `pixel ${x},${y}`);
  }
});

test('the as-is share and the display layers follow the colour to the display', () => {
  const layer = (x: number, y: number) => noisy(x, y).map((c) => c * 0.5);
  const frame: UpscaleFrame = {
    render: [8, 8],
    display: [12, 12],
    jitter: [0.3, 0.1],
    color: noisy,
    flag: (x, y) => noisy(x, y)[0],
    layer,
    moving: true,
  };
  const resolve = upscaleRun(frame, true, true);
  for (const [x, y] of [
    [1, 1],
    [6, 9],
    [11, 4],
  ]) {
    const out = resolve(x, y);
    // The colour's weights, bounded by their own 3×3 box.
    const red = (x: number, y: number) => [noisy(x, y)[0], 0, 0, 0];
    near([out.share], owed({ ...frame, color: red }, x, y, 'box').slice(0, 1), 'share');
    for (const filtered of out.layers)
      near(filtered, owed({ ...frame, color: layer }, x, y, 'box'), 'layer');
  }
  // History: the native resolve's clamp and inverse-luminance blend, the same text, a still
  // pixel's share from the weights its average holds (#1343).
  for (const asIs of [true, false])
    assert.ok(taaUpscaleShader(asIs).includes(taaHistoryBlend(asIs, false, STILL_AVERAGE_WGSL)));
  assert.ok(TAA_SHADER.includes(taaHistoryBlend(true)));
  const layered = taaHistoryBlend(true, true, STILL_AVERAGE_WGSL);
  assert.ok(taaUpscaleShader(true, false, true).includes(layered));
  // The flagless one reads neither flags nor share history.
  assert.doesNotMatch(taaUpscaleShader(false), /var flags|textureLoad\(flags|shareHistory/);
});
