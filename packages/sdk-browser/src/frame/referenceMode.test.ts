import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REFERENCE_APPROXIMATIONS,
  REFERENCE_BOUNCE_BUDGET_MS,
  referenceCapture,
  referenceOptions,
  referenceSupersampling,
  resolveSupersampled,
} from './referenceMode.ts';
import { BOUNCE_SETTINGS } from '../../../sdk-core/src/index.ts';

const BOSS = { manifestUrl: 'm.json', width: 1728, height: 1117, pixelRatio: 2 };

test('outside reference mode, the options are the page’s own, untouched', () => {
  const options = { ...BOSS, renderScale: 'auto' as const };
  assert.deepEqual(referenceOptions(options), { options, reference: null });
});

test('reference mode switches off every approximation it names, whatever the page asked', () => {
  const asked = { ...BOSS, reference: true, renderScale: 0.5, temporalAntialiasing: true };
  const { options, reference } = referenceOptions(asked);
  assert.deepEqual(reference?.approximations, REFERENCE_APPROXIMATIONS);
  // renderScale: the display itself.
  assert.equal(options.renderScale, 1);
  // temporalReuse: no jitter, no history.
  assert.equal(options.temporalAntialiasing, false);
  // probeBudget: far past the default target, so the probes run at their ceiling.
  assert.equal(options.bounceBudgetMs, REFERENCE_BOUNCE_BUDGET_MS);
  assert.ok(REFERENCE_BOUNCE_BUDGET_MS > 100 * BOUNCE_SETTINGS.budgetMs);
  // supersampling: 2 per axis at the boss's case, 6912 × 4468 drawn for 3456 × 2234 shown.
  assert.equal(reference?.supersampling, 2);
  assert.equal(options.pixelRatio, 4);
  // shadowResolution: a shrunk pool refuses the capture by name.
  const capture = referenceCapture(
    () => new Uint8Array(16),
    { width: 2, height: 2 },
    reference,
    () => 1,
  );
  assert.throws(capture, { code: 'REFERENCE_SHADOWS_REDUCED' });
});

test('the supersampling is the most the portable texture side holds, 1 to 4 per axis', () => {
  assert.equal(referenceSupersampling(640, 360, 1), 4);
  assert.equal(referenceSupersampling(1728, 1117, 2), 2);
  assert.equal(referenceSupersampling(4096, 2160, 2), 1);
  // Sized as the canvas is: 1639 at 1.25 is 2048 device pixels, but 8195 at four times the ratio.
  assert.equal(referenceSupersampling(1639, 1000, 1.25), 3);
});

test('the resolved image is the linear-light mean of each block, the same bytes on every run', () => {
  // A 4 × 2 image: a black and white 2 × 2 block, then a flat grey one.
  const rgba = new Uint8Array(4 * 2 * 4);
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 4; x++) {
      const v = x < 2 ? ((x + y) % 2) * 255 : 128;
      rgba.set([v, v, v, 255], (y * 4 + x) * 4);
    }
  const once = resolveSupersampled(rgba, 4, 2, 2);
  // Half the light of white, re-encoded: 188, not the 128 of a mean of the bytes.
  assert.deepEqual([...once], [188, 188, 188, 255, 128, 128, 128, 255]);
  assert.deepEqual(resolveSupersampled(rgba, 4, 2, 2), once);
  const capture = referenceCapture(
    () => rgba,
    { width: 4, height: 2 },
    referenceOptions({ ...BOSS, reference: true }).reference,
    () => 0,
  );
  assert.deepEqual(capture(), once);
});

test('reference mode refuses an interactive session, whose resize would drop the supersampling', () => {
  assert.throws(() => referenceOptions({ ...BOSS, reference: true, interactive: true }), {
    code: 'REFERENCE_INTERACTIVE',
  });
});
