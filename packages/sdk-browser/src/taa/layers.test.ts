// #558: the display layers, tint and added value, follow the colour through the temporal resolve —
// the native one and the upscaling one, run from their shipped text (`upscaleRun.fixture.ts`):
// weighed as the colour, clamped to their own 3×3 box, mixed with their history by the colour's
// weights once that history holds the last image's, and never read before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { upscaleRun, type UpscaleFrame } from './upscaleRun.fixture.ts';
import { owed } from './upscaleOwed.fixture.ts';
import { TAA_WEIGHTS, taaWeights } from './filterWeights.ts';

/** Within the uniform's 32-bit weights, whose sum is 1 to 1e-9. */
const near = (a: number[], b: number[], what: string) =>
  a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-6, `${what}: ${a} against ${b}`));

/** A checker: every 3×3 holds both values, so each layer's box is [0.2, 0.6]. */
const checker = (x: number, y: number) => new Array<number>(4).fill((x + y) % 2 ? 0.6 : 0.2);
/** A flat colour and a history of that same colour: the current image weighs 0.25 exactly. */
const flat = [0.3, 0.3, 0.3, 1];
const JITTER: [number, number] = [0.3, -0.2];

/** The native resolve's 3×3 of `layer` at `(px, py)`, weighed by the jitter's table. */
function weighed(layer: typeof checker, px: number, py: number, size: number) {
  const weights = taaWeights(...JITTER, new Float32Array(TAA_WEIGHTS), 0),
    sum = [0, 0, 0, 0],
    inGrid = (v: number) => Math.min(Math.max(v, 0), size - 1);
  for (let k = 0; k < 9; k++) {
    const value = layer(inGrid(px + (k % 3) - 1), inGrid(py + Math.floor(k / 3) - 1));
    value.forEach((v, c) => (sum[c] += v * weights[k]));
  }
  return sum;
}

const clampBox = (v: number) => Math.min(Math.max(v, 0.2), 0.6);
const mixed = (now: number[], history: number) =>
  now.map((v) => 0.25 * v + 0.75 * clampBox(history));

/** The four resolves of `frame`: no history, a colour history only, and one whose layers' history
 *  holds the last image's, of value `held.kept`. */
function resolves(frame: UpscaleFrame, native: boolean, held: { kept: number }) {
  const run = (more: Partial<UpscaleFrame>) =>
    upscaleRun({ ...frame, ...more }, true, true, native);
  return {
    first: run({}),
    unwritten: run({ history: () => flat }),
    written: run({ history: () => flat, layerHistory: () => new Array<number>(4).fill(held.kept) }),
  };
}

/** Each resolve of `frame` at `pixels` against `now`, the layers the current image owes there. */
function assertLayers(
  frame: UpscaleFrame,
  native: boolean,
  now: (x: number, y: number) => number[],
) {
  const held = { kept: 0 },
    { first, unwritten, written } = resolves(frame, native, held);
  for (const [x, y] of [
    [0, 0],
    [2, 3],
    [5, 1],
  ]) {
    for (const layer of first(x, y).layers) near(layer, now(x, y), `no history at ${x},${y}`);
    // A history that does not hold the last image's layers is not read into them.
    for (const layer of unwritten(x, y).layers) near(layer, now(x, y), `unwritten at ${x},${y}`);
    for (held.kept of [5, 0.45, -5]) {
      const out = written(x, y);
      near(out.color, flat, 'the colour');
      for (const layer of out.layers)
        near(layer, mixed(now(x, y), held.kept), `history ${held.kept} at ${x},${y}`);
    }
  }
}

test('the native resolve weighs the layers as the colour, and mixes their written history', () => {
  const frame: UpscaleFrame = {
    render: [6, 6],
    display: [6, 6],
    jitter: JITTER,
    color: () => flat,
    layer: checker,
  };
  assertLayers(frame, true, (x, y) => weighed(checker, x, y, 6));
});

test('the upscaling resolve clamps the layers to their box and mixes their written history', () => {
  const frame: UpscaleFrame = {
    render: [4, 4],
    display: [6, 6],
    jitter: JITTER,
    color: () => flat,
    layer: checker,
    // Moving, since a still image below the display averages by its own weights (#1343); a
    // reactive value of 0.25 holds the current share at 0.25 whatever each pixel's reach.
    moving: true,
    reactive: () => 0.25,
  };
  assertLayers(frame, false, (x, y) => owed({ ...frame, color: checker }, x, y, 'box'));
});
