// #1281: `bench.ts --reference` holds each capture to the engine's reference image of its scene and
// view, and refuses by name a run that cannot be compared with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodePng } from '../../packages/sdk-node/src/cutout/png.mts';
import { againstReference, referenceLines, sceneReference } from './referenceProof.ts';
import { imageSettings, referenceImage, type ReferenceRecord } from './referenceStore.ts';
import { rapport } from './summaryTestFixtures.ts';
import type { BenchSettings } from './benchSettings.ts';

/** A 2 × 2 reference of `scene-test`, drawn bottom row red and top row green, written in `dir`. */
function stored(settings: BenchSettings, pose: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'reference-'));
  const body = Buffer.from([255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255]);
  mkdirSync(join(dir, 'scene-test'));
  writeFileSync(join(dir, 'scene-test', 'salon.png'), encodePng(2, 2, body, true));
  const view = { pose, file: 'salon.png', sha256: '', width: 2, height: 2, settleFrames: 1 };
  const record = {
    scene: 'scene-test',
    commit: 'abcdef0123456789',
    dirty: false,
    pathVersion: 1,
    settings: imageSettings(settings),
    views: { salon: view },
  } as unknown as ReferenceRecord;
  writeFileSync(join(dir, 'scene-test', 'reference.json'), JSON.stringify(record));
  return { dir, body, record };
}

test('each side’s capture is scored against the reference of its view, rows as captured', () => {
  const report = rapport({});
  const [serie] = report.series;
  const { dir, body, record } = stored(report.settings, serie.pose);
  assert.deepEqual(referenceImage(record, 'salon', dir)?.body, body, 'bottom row first, as read');
  const off = Buffer.from(body);
  off[0] = 245;
  const captures = new Map([
    ['same.png', { body, w: 2, h: 2 }],
    ['off.png', { body: off, w: 2, h: 2 }],
  ]);
  const diffs = againstReference(
    sceneReference(report, dir),
    serie,
    { a: 'same.png', b: 'off.png' },
    captures,
    dir,
  );
  assert.ok(diffs.a && 'flipMean' in diffs.a && diffs.b && 'flipMean' in diffs.b);
  assert.equal(diffs.a.reference, 'scene-test/salon.png @ abcdef012345');
  assert.equal(diffs.a.pixels, 0);
  assert.equal(diffs.b.pixels, 1);
  assert.ok(diffs.b.flipMean > 0);
  serie.referenceDiff = diffs;
  assert.ok(referenceLines(report).some((line) => line.includes('| salon | 1 | b |')));
});

test('a run the reference cannot judge is refused by name, never scored', () => {
  const report = rapport({});
  const { dir } = stored(report.settings, report.series[0].pose);
  assert.throws(() => sceneReference({ ...report, scene: 'other' }, dir), /no reference image/);
  const wider = { ...report, settings: { ...report.settings, width: 1280 } };
  assert.throws(() => sceneReference(wider, dir), /width differ/);
  const moving = { ...report, settings: { ...report.settings, movingCamera: true } };
  assert.throws(() => sceneReference(moving, dir), /moving camera/);
  const record = sceneReference(report, dir);
  const moved = { ...report.series[0], pose: { ...report.series[0].pose, fov: 60 } };
  assert.throws(() => againstReference(record, moved, {}, new Map(), dir), /reference pose/);
  assert.throws(
    () => againstReference(record, { ...moved, view: 'hall' }, {}, new Map(), dir),
    /no reference for hall/,
  );
});
