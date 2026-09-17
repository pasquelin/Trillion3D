import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { reviewCutouts } from './cutoutReview.mts';
import { SHEET_FILE } from './cutoutSheet.mts';
import { answerOf } from './cutoutAsk.mts';
import { imageKind } from './cutoutDraw.mts';
import { encodePng } from './cutoutPng.mts';

/** A compiled model with a sheet and nothing else: the pass must work without a cache to read. */
async function model(id, textures) {
  const cache = await mkdtemp(join(tmpdir(), `wg-${id}-`));
  await writeFile(join(cache, SHEET_FILE), JSON.stringify({ version: 1, textures }));
  return { id, source: join(cache, 'source.gltf'), cache, resourceBaseUrl: '/x/' };
}

const leaf = (blendPrimitives) => ({
  image: 'feuillage.png',
  used: true,
  measure: { betweenPercent: 4.3, atContourPercent: 99.7, absentPercent: 85.8 },
  blendPrimitives,
  proposal: 'cutout',
  cutout: null,
});

/** A terminal that collects what was written, and a keyboard that answers on its own. */
function screen(keys) {
  const written = [];
  const stream = { isTTY: true, write: (text) => written.push(text) };
  const input = new PassThrough();
  input.setRawMode = () => {};
  let at = 0;
  const timer = setInterval(() => {
    if (at < keys.length) input.write(keys[at++]);
    else clearInterval(timer);
  }, 5);
  return { stream, input, written, stop: () => clearInterval(timer) };
}

// Comportement : hors terminal — un journal, un enchaînement automatique — rien n'est demandé. La
// liste est écrite et le lot s'arrête là, sans jamais bloquer sur une question que personne ne lit.
test('hors terminal, la liste est écrite et rien n’est demandé', async () => {
  const job = await model('emerald', { abc: leaf(3) });
  const written = [];
  const summary = await reviewCutouts([job], {
    interactive: false,
    stream: { isTTY: false, write: (text) => written.push(text) },
  });
  assert.deepEqual(summary, { pending: 1, answered: 0, recompiled: [] });
  assert.match(written.join(''), /feuillage\.png/);
});

// Comportement : Entrée accepte la proposition, `v` la refuse, et la réponse tombe dans TOUTES les
// feuilles qui connaissent la texture — c'est ce qui fait qu'on ne répond qu'une fois pour un
// feuillage partagé. Seuls les modèles changés sont recompilés.
test('une réponse remplit toutes les feuilles concernées et ne recompile que celles-là', async () => {
  const shared = await model('emerald', { abc: leaf(3), def: { ...leaf(1), image: 'vitre.png' } });
  const other = await model('bistro', { abc: leaf(5) });
  const untouched = await model('ville', { zzz: { ...leaf(0), cutout: true } });
  const keyboard = screen(['\r', 'v']);
  const recompiled = [];
  const summary = await reviewCutouts([shared, other, untouched], {
    stream: keyboard.stream,
    input: keyboard.input,
    rerun: async (jobs) => recompiled.push(...jobs.map((job) => job.id)),
  });
  keyboard.stop();
  assert.equal(summary.answered, 2);
  assert.deepEqual(summary.recompiled.sort(), ['bistro', 'emerald']);
  assert.deepEqual(recompiled.sort(), ['bistro', 'emerald']);
  const sheet = JSON.parse(await readFile(join(shared.cache, SHEET_FILE), 'utf8'));
  assert.equal(sheet.textures.abc.cutout, true, 'Entrée a pris la proposition');
  assert.equal(sheet.textures.def.cutout, false, '`v` a répondu vitre');
  const elsewhere = JSON.parse(await readFile(join(other.cache, SHEET_FILE), 'utf8'));
  assert.equal(elsewhere.textures.abc.cutout, true, 'la même image est répondue partout');
});

// Comportement : la règle est rappelée avant la première question, et `?` la réaffiche sans
// répondre à la place de personne — la question est reposée telle quelle.
test('la règle est rappelée d’entrée, et `?` la réaffiche', async () => {
  const job = await model('emerald', { a: leaf(9) });
  const keyboard = screen(['?', 'v']);
  const summary = await reviewCutouts([job], {
    stream: keyboard.stream,
    input: keyboard.input,
    rerun: async () => {},
  });
  keyboard.stop();
  const ecran = keyboard.written.join('');
  assert.equal(summary.answered, 1, '`?` n’a rien répondu, `v` a tranché');
  assert.match(ecran, /Une DÉCOUPE est présente ou absente/);
  assert.equal(
    ecran.split('Une VITRE laisse passer').length - 1,
    2,
    'la règle est écrite deux fois : à l’entrée, puis sur demande',
  );
});

// Comportement : `t` accepte tout le reste d'un coup, `q` arrête en gardant ce qui est déjà répondu.
test('`t` accepte le reste, `q` arrête sans perdre les réponses données', async () => {
  const job = await model('emerald', { a: leaf(9), b: leaf(8), c: leaf(7) });
  const keyboard = screen(['t']);
  const summary = await reviewCutouts([job], {
    stream: keyboard.stream,
    input: keyboard.input,
    rerun: async () => {},
  });
  keyboard.stop();
  assert.equal(summary.answered, 3, 'les trois sont tranchées après une seule touche');

  const stopped = await model('bistro', { a: leaf(9), b: leaf(8) });
  const second = screen(['d', 'q']);
  const after = await reviewCutouts([stopped], {
    stream: second.stream,
    input: second.input,
    rerun: async () => {},
  });
  second.stop();
  assert.equal(after.answered, 1, 'ce qui était répondu est gardé');
});

// Comportement : chaque terminal reçoit ce qu'il sait afficher, et le PNG écrit est un vrai PNG.
test('le terminal reçoit ce qu’il sait afficher, et le PNG est un PNG', () => {
  assert.equal(imageKind({ TERM: 'xterm-kitty' }), 'kitty');
  assert.equal(imageKind({ TERM_PROGRAM: 'WarpTerminal' }), 'kitty');
  assert.equal(imageKind({ TERM_PROGRAM: 'iTerm.app' }), 'iterm');
  assert.equal(imageKind({ TERM: 'xterm-256color' }), 'blocks');
  assert.equal(answerOf('\r', false), 'blend', 'Entrée suit la proposition');
  assert.equal(answerOf('d', false), 'cutout');
  assert.equal(answerOf('', true), 'quit');
  assert.equal(answerOf('z', true), null);
  assert.equal(answerOf('?', true), 'help', 'le rappel de la règle est à une touche');
  const png = encodePng(2, 2, new Uint8Array(16).fill(200));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
});
