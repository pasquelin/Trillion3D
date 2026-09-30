// A still image drawn below the display (#1343), run in JavaScript: its average is weighed by how
// near each image's samples fell to the display pixel, and rebuilds the display size's detail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../../../site/examples/kit/random.ts';
import { blend, upscaleRun, type UpscaleFrame } from './upscaleRun.fixture.ts';
import { taaJitter, taaStillFrames, upscalePhases } from './jitter.ts';

const near = (a: number[], b: number[], what: string) =>
  a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-6, `${what}: ${a} against ${b}`));
const random = mulberry32(1343);
const noise = Array.from({ length: 64 }, () => [random(), random(), random(), 1]);
const noisy = (x: number, y: number) => noise[y * 8 + x];

test('a still pixel weighs this image by how near its sample fell, against the weight held', () => {
  // Display pixel 2,2 of 16 lies at 0.75 of the 8×8 grid: with `ON` texel 1,1's sample lands on
  // it (weight 1), with `FAR` none falls within one display pixel. The history holds a weight of 3.
  const history = noisy(2, 1);
  const still = (jitter: [number, number]): UpscaleFrame => ({
    render: [8, 8],
    display: [16, 16],
    jitter,
    color: noisy,
    history: () => history,
    tags: () => [0, 0, Math.sqrt(3 / 16), 0],
  });
  const on = upscaleRun(still([0.25, -0.25]))(2, 2);
  near(on.color, blend(noisy(1, 1), history, 1 / 4), 'a sample on the pixel: a quarter');
  assert.ok(Math.abs(on.held - Math.sqrt(4 / 16)) < 1e-6, 'the weight held grows by one');
  const far = upscaleRun(still([-0.25, 0.25]))(2, 2);
  near(far.color, history, 'no sample near: the average untouched');
  assert.ok(Math.abs(far.held - Math.sqrt(3 / 16)) < 1e-6);
});

/** Stripes one display pixel wide: the finest detail the display shows. */
const stripe = (x: number) => (((Math.floor(x) % 2) + 2) % 2 ? [1, 1, 1, 1] : [0, 0, 0, 1]);

/** The still image of the stripes a display of 16 holds once held (`taaStillFrames`), drawn at
 *  `render` pixels per axis: every image a resolve, its output the next one's history. */
function converged(render: number) {
  const display = 16,
    native = render === display,
    phases = upscalePhases(render, display),
    jitter = new Float64Array(2),
    at = (uv: number[]) => Math.floor(uv[1] * display) * display + Math.floor(uv[0] * display);
  let color: number[][] = [],
    held: number[] = [];
  for (let image = 0; image < taaStillFrames(phases); image++) {
    const [jx, jy] = taaJitter(image, jitter, phases),
      previous = color,
      stored = held;
    const resolve = upscaleRun(
      {
        render: [render, render],
        display: [display, display],
        jitter: [jx, jy],
        color: (x) => stripe(((x - jx + 0.5) * display) / render),
        history: image ? (uv) => previous[at(uv)] : undefined,
        tags: (uv) => [0, 0, stored[at(uv)], 0],
        share: 1 / (image + 1),
      },
      false,
      false,
      native,
    );
    color = [];
    held = [];
    for (let i = 0; i < display * display; i++) {
      const out = resolve(i % display, Math.floor(i / display));
      color.push(out.color);
      held.push(out.held);
    }
  }
  return color;
}

/** The mean step between neighbours of a row away from the edges: 1 for sharp stripes. */
function contrast(image: number[][]) {
  let sum = 0;
  for (let x = 4; x < 12; x++) sum += Math.abs(image[8 * 16 + x][0] - image[8 * 16 + x + 1][0]);
  return sum / 8;
}

test('a still image drawn at half the display holds the detail the display size shows', () => {
  const native = contrast(converged(16)),
    half = contrast(converged(8));
  assert.ok(native > 0.5, `the native still image keeps the stripes: ${native}`);
  assert.ok(half >= 0.8 * native, `at half the display ${half}, native ${native}`);
});
