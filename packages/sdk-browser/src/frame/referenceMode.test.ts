import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceOptions, referenceSunWindow } from './referenceMode.ts';
import { LIGHT_SETTINGS } from '../../../sdk-core/src/index.ts';

const BOSS = { manifestUrl: 'm.json', width: 1728, height: 1117, pixelRatio: 2 };

test('outside reference mode, the options are the page’s own, untouched', () => {
  const options = { ...BOSS, renderScale: 'auto' as const };
  assert.deepEqual(referenceOptions(options), { options, reference: null });
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
