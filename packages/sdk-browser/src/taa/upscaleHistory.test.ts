// The upscaled resolve's history while the image moves (#833), run in JavaScript.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../../../site/examples/kit/random.ts';
import { blend, owed, upscaleRun, type UpscaleFrame } from './upscaleRun.fixture.ts';
import { FLAG_DYNAMIC } from '../visibility/types.ts';

const near = (a: number[], b: number[], what: string) =>
  a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-9, `${what}: ${a} against ${b}`));
const random = mulberry32(833);
const noise = Array.from({ length: 64 }, () => [random(), random(), random(), 1]);
const noisy = (x: number, y: number) => noise[y * 8 + x];
/** A history of one colour, the render texel 1,1's: inside the box of the display pixel 2,2. */
const kept = noisy(1, 1);
// Display pixel 2,2 of 16 lies at 0.75 of the 8×8 render grid; with this jitter the nearest
// sample is 0.71 render pixel away, 1.41 display pixels, where Lanczos-2 gives nothing; with the
// other, a sample lands on it.
const FAR: [number, number] = [-0.25, 0.25],
  ON: [number, number] = [0.25, -0.25];
const frame = (extra: Partial<UpscaleFrame> = {}): UpscaleFrame => ({
  render: [8, 8],
  display: [16, 16],
  color: noisy,
  history: () => kept,
  moving: true,
  ...extra,
});

test('a pixel with no history takes the current sample whole: first image, or uncovered', () => {
  const first = frame({ history: undefined });
  near(upscaleRun(first)(2, 2).color, owed(first, 2, 2), 'first image');
  // The four history texels held a ball (tag 1) no render texel of the 3×3 shows now.
  const gone = frame({ jitter: ON, tags: () => [1, 1, 1, 1].map((tag) => tag / 255) });
  near(upscaleRun(gone)(2, 2).color, owed(gone, 2, 2), 'uncovered');
  // Still around the pixel — one texel of its 3×3 is the ball —: an edge, the history kept.
  const edge = { ...gone, id: (x: number, y: number) => (x === 2 && y === 1 ? 1 << 8 : 0) };
  assert.notDeepEqual(upscaleRun(edge)(2, 2).color, owed(edge, 2, 2));
  // At rest nothing is told uncovered: the sample on the pixel meets the history, one colour.
  const still = { ...gone, moving: false };
  near(upscaleRun(still)(2, 2).color, kept, 'at rest');
});

test('each pixel writes the tag of the placement its nearest texel shows', () => {
  const resolve = upscaleRun(frame({ id: (x) => (x >= 4 ? 1 << 8 : 0) }));
  assert.equal(resolve(2, 2).tag, 0, 'the background');
  assert.equal(resolve(12, 2).tag, 1, "placement 0's");
});

test('a sample far from its display pixel does not overwrite its history', () => {
  near(upscaleRun(frame({ jitter: FAR }))(2, 2).color, kept, 'nothing of the current image');
  const on = frame({ jitter: ON });
  near(upscaleRun(on)(2, 2).color, blend(owed(on, 2, 2), kept, 0.25), 'the whole share');
});

test('a reactive value shortens the history, up to 0.9 of the current image', () => {
  for (const [rho, alpha] of [
    [0.5, 0.5],
    [1, 0.9],
  ]) {
    const glass = frame({ jitter: FAR, reactive: () => rho });
    near(upscaleRun(glass)(2, 2).color, blend(owed(glass, 2, 2), kept, alpha), `reactive ${rho}`);
  }
});

test('the reactive value acts only while the image moves: at rest, the still average', () => {
  // The image still: the history read is the single bilinear tap and the reactive value the blends,
  // particles and water wrote is not read, so the still average's share stands whatever `rho`
  // holds: this image's weight, one, against the three the history holds (#1343).
  const then = noisy(2, 1);
  for (const rho of [0, 0.1, 0.5, 1]) {
    const glass = frame({
      jitter: ON,
      moving: false,
      history: () => then,
      tags: () => [0, 0, Math.sqrt(3 / 16), 0],
      reactive: () => rho,
    });
    near(upscaleRun(glass)(2, 2).color, blend(kept, then, 1 / 4), `reactive ${rho} at rest`);
  }
});

test('the history is read with Catmull-Rom in five taps while moving, one tap at rest', () => {
  assert.equal(upscaleRun(frame())(2, 2).reads.length, 5);
  assert.equal(upscaleRun(frame({ moving: false }))(2, 2).reads.length, 1);
});

test('a dynamic geometry rejects its history as a reactive pixel does, no ghost of its old vertices', () => {
  const on = { id: () => 1 << 8, pageFlags: FLAG_DYNAMIC },
    wave = frame({ jitter: FAR, ...on });
  near(upscaleRun(wave)(2, 2).color, blend(owed(wave, 2, 2), kept, 0.9), 'dynamic');
  const still = frame({ jitter: FAR, id: on.id });
  near(upscaleRun(still)(2, 2).color, kept, 'a paged geometry keeps its history');
});
