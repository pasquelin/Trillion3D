import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { reviewCutouts } from './cutoutReview.mts';
import { SHEET_FILE, type Sheet } from './cutoutSheet.mts';
import { leaf } from './cutoutFixture.ts';
import type { CutoutModel, CutoutReviewSummary } from './contracts.ts';

/** A compiled model with a sheet and nothing else: the pass must work without a cache to read. */
async function model(id: string, textures: Sheet['textures']): Promise<CutoutModel> {
  const cache = await mkdtemp(join(tmpdir(), `wg-${id}-`));
  await writeFile(join(cache, SHEET_FILE), JSON.stringify({ version: 1, textures }));
  return { id, source: join(cache, 'source.gltf'), cache };
}

const sheetOf = async (one: CutoutModel): Promise<Sheet> =>
  JSON.parse(await readFile(join(one.cache, SHEET_FILE), 'utf8')) as Sheet;

/** The subset of a raw keyboard the review reads, delivering keys one at a time. */
interface FakeKeyboard extends EventEmitter {
  isRaw: boolean;
  setRawMode: () => void;
  pause: () => FakeKeyboard;
  resume: () => FakeKeyboard;
}

/** Delivers exactly one key for each read, after that read has installed its listener. */
function keyboard(keys: string[]): FakeKeyboard {
  const input = new EventEmitter() as FakeKeyboard;
  let at = 0;
  input.isRaw = false;
  input.setRawMode = () => {};
  input.pause = () => input;
  input.resume = () => {
    const key = keys[at++];
    if (key === undefined) throw new Error('cutout review asked for an unexpected key');
    queueMicrotask(() => input.emit('data', Buffer.from(key)));
    return input;
  };
  return input;
}

/**
 * One pass, answered by a keyboard that types on its own: a terminal that collects what was written
 * and a stream of keys delivered one at a time, so a single press is never read as several.
 */
async function passe(
  models: CutoutModel[],
  keys: string[],
): Promise<{ summary: CutoutReviewSummary; ecran: string }> {
  const written: string[] = [];
  const summary = await reviewCutouts(models, {
    stream: { isTTY: true, write: (text) => written.push(text) },
    // The review only ever reads `isRaw`/`setRawMode`/`pause`/`resume`/`data`: the real
    // `NodeJS.ReadStream` interface is far richer than a keyboard double can honestly implement.
    input: keyboard(keys) as unknown as NodeJS.ReadStream,
  });
  return { summary, ecran: written.join('') };
}

// Behaviour: off a terminal — a log, an automated chain — nothing is asked. The list is written
// and the batch stops there, never blocking on a question nobody reads.
test('off a terminal, the list is written and nothing is asked', async () => {
  const one = await model('emerald', { abc: leaf(3) });
  const written: string[] = [];
  const summary = await reviewCutouts([one], {
    stream: { isTTY: false, write: (text) => written.push(text) },
  });
  assert.deepEqual(summary, { pending: 1, answered: 0, changed: [] });
  assert.match(written.join(''), /feuillage\.png/);
});

// Behaviour: Enter accepts the proposal, `v` refuses it, and the answer lands in EVERY sheet that
// knows the texture — that is why a shared leaf is answered only once. The pass RETURNS the
// changed models and recompiles none of them: the caller compiles, with its own options.
test('an answer fills every concerned sheet and returns the changed models', async () => {
  const shared = await model('emerald', { abc: leaf(3), def: { ...leaf(1), image: 'vitre.png' } });
  const other = await model('bistro', { abc: leaf(5) });
  const untouched = await model('ville', { zzz: { ...leaf(0), cutout: true } });
  const { summary } = await passe([shared, other, untouched], ['\r', 'v']);
  assert.equal(summary.answered, 2);
  assert.deepEqual(
    summary.changed.map((one) => one.id).sort(),
    ['bistro', 'emerald'],
    'the already-answered model is left alone',
  );
  const sheet = await sheetOf(shared);
  assert.equal(sheet.textures.abc.cutout, true, 'Enter took the proposal');
  assert.equal(sheet.textures.def.cutout, false, '`v` answered blend');
  assert.equal(
    (await sheetOf(other)).textures.abc.cutout,
    true,
    'the same image is answered everywhere',
  );
});

// Behaviour: the rule is recalled before the first question, and `?` redisplays it without
// answering for anyone — the question is asked again as it was.
test('the rule is recalled at the start, and `?` redisplays it', async () => {
  const one = await model('emerald', { a: leaf(9) });
  const { summary, ecran } = await passe([one], ['?', 'v']);
  assert.equal(summary.answered, 1, '`?` answered nothing, `v` decided');
  assert.match(ecran, /A CUTOUT is present or absent/);
  assert.equal(
    ecran.split('A BLEND lets light through').length - 1,
    2,
    'the rule is written twice: at the start, then on demand',
  );
});

// Behaviour: `t` accepts the rest in one go.
test('`t` accepts the rest in one go', async () => {
  const one = await model('emerald', { a: leaf(9), b: leaf(8), c: leaf(7) });
  const { summary } = await passe([one], ['t']);
  assert.equal(summary.answered, 3, 'all three are decided after a single key');
});

// Behaviour: `q` stops the pass while keeping what is already answered.
test('`q` stops without losing the answers already given', async () => {
  const one = await model('bistro', { a: leaf(9), b: leaf(8) });
  const { summary } = await passe([one], ['d', 'q']);
  assert.equal(summary.answered, 1, 'what was already answered is kept');
  assert.equal((await sheetOf(one)).textures.b.cutout, null, 'the rest is still waiting');
});
