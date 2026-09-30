import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceCapture, referenceOptions, referenceSunWindow } from './referenceMode.ts';
import { BOUNCE_SETTINGS, LIGHT_SETTINGS } from '../../../sdk-core/src/index.ts';
import { resolveSupersampled } from './referenceTilePlacement.ts';
import { REFERENCE_APPROXIMATIONS, REFERENCE_BOUNCE_BUDGET_MS } from './referenceApproximations.ts';

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
  // supersampling: tiles, not a canvas the portable side caps at 2 per axis.
  assert.ok(reference?.factor && reference.factor > 2);
  // The canvas keeps the display's pixels: the tiles are drawn aside.
  assert.equal(options.pixelRatio, 2);
  // shadowResolution: a shrunk pool refuses the capture by name.
  const capture = referenceCapture(
    () => new Uint8Array(16),
    reference,
    () => 1,
  );
  assert.throws(capture, { code: 'REFERENCE_SHADOWS_REDUCED' });
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
});

test('the reference raises the sun window so every pixel reads the finest clipmap level', () => {
  // The boss's case: 2234 device pixels at 55° reach 4291, and `pages · shadowPage / 2` must
  // hold that — 68 pages, even so `sunLevels` centres them, past the ordinary 64.
  const boss = referenceSunWindow(1117 * 2, 55);
  assert.equal(boss, 68);
  assert.ok(boss > LIGHT_SETTINGS.sunLevelPages);
  assert.ok((boss * LIGHT_SETTINGS.shadowPage) / 2 >= 4291, 'the window reaches the whole view');
  // The session's own canvas and field, not one case: a taller view or a narrower field needs a
  // wider window; the field defaults to the camera's; the ordinary one is never lowered.
  assert.ok(referenceSunWindow(4470, 55) > boss);
  assert.ok(referenceSunWindow(1117 * 2, 40) > boss);
  assert.equal(referenceSunWindow(1117 * 2), boss);
  assert.equal(referenceSunWindow(1), LIGHT_SETTINGS.sunLevelPages);
});

test('reference mode refuses an interactive session, whose resize would drop the supersampling', () => {
  assert.throws(() => referenceOptions({ ...BOSS, reference: true, interactive: true }), {
    code: 'REFERENCE_INTERACTIVE',
  });
});
