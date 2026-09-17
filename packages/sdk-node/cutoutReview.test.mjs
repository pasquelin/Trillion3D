import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { reviewCutouts } from './cutoutReview.mts';
import { SHEET_FILE } from './cutoutSheet.mts';
import { leaf } from './cutoutFixture.mjs';

/** A compiled model with a sheet and nothing else: the pass must work without a cache to read. */
async function model(id, textures) {
  const cache = await mkdtemp(join(tmpdir(), `wg-${id}-`));
  await writeFile(join(cache, SHEET_FILE), JSON.stringify({ version: 1, textures }));
  return { id, source: join(cache, 'source.gltf'), cache };
}

const sheetOf = async (one) => JSON.parse(await readFile(join(one.cache, SHEET_FILE), 'utf8'));

/**
 * One pass, answered by a keyboard that types on its own: a terminal that collects what was written
 * and a stream of keys delivered one at a time, so a single press is never read as several.
 */
async function passe(models, keys) {
  const written = [];
  const input = new PassThrough();
  input.setRawMode = () => {};
  let at = 0;
  const timer = setInterval(() => {
    if (at < keys.length) input.write(keys[at++]);
    else clearInterval(timer);
  }, 5);
  try {
    const summary = await reviewCutouts(models, {
      stream: { isTTY: true, write: (text) => written.push(text) },
      input,
    });
    return { summary, ecran: written.join('') };
  } finally {
    clearInterval(timer);
  }
}

// Comportement : hors terminal — un journal, un enchaînement automatique — rien n'est demandé. La
// liste est écrite et le lot s'arrête là, sans jamais bloquer sur une question que personne ne lit.
test('hors terminal, la liste est écrite et rien n’est demandé', async () => {
  const one = await model('emerald', { abc: leaf(3) });
  const written = [];
  const summary = await reviewCutouts([one], {
    stream: { isTTY: false, write: (text) => written.push(text) },
  });
  assert.deepEqual(summary, { pending: 1, answered: 0, changed: [] });
  assert.match(written.join(''), /feuillage\.png/);
});

// Comportement : Entrée accepte la proposition, `v` la refuse, et la réponse tombe dans TOUTES les
// feuilles qui connaissent la texture — c'est ce qui fait qu'on ne répond qu'une fois pour un
// feuillage partagé. La passe REND les modèles changés et n'en recompile aucun : c'est l'appelant
// qui compile, avec ses propres options.
test('une réponse remplit toutes les feuilles concernées et rend les modèles changés', async () => {
  const shared = await model('emerald', { abc: leaf(3), def: { ...leaf(1), image: 'vitre.png' } });
  const other = await model('bistro', { abc: leaf(5) });
  const untouched = await model('ville', { zzz: { ...leaf(0), cutout: true } });
  const { summary } = await passe([shared, other, untouched], ['\r', 'v']);
  assert.equal(summary.answered, 2);
  assert.deepEqual(
    summary.changed.map((one) => one.id).sort(),
    ['bistro', 'emerald'],
    'le modèle déjà tranché n’est pas touché',
  );
  const sheet = await sheetOf(shared);
  assert.equal(sheet.textures.abc.cutout, true, 'Entrée a pris la proposition');
  assert.equal(sheet.textures.def.cutout, false, '`v` a répondu vitre');
  assert.equal(
    (await sheetOf(other)).textures.abc.cutout,
    true,
    'la même image est répondue partout',
  );
});

// Comportement : la règle est rappelée avant la première question, et `?` la réaffiche sans
// répondre à la place de personne — la question est reposée telle quelle.
test('la règle est rappelée d’entrée, et `?` la réaffiche', async () => {
  const one = await model('emerald', { a: leaf(9) });
  const { summary, ecran } = await passe([one], ['?', 'v']);
  assert.equal(summary.answered, 1, '`?` n’a rien répondu, `v` a tranché');
  assert.match(ecran, /Une DÉCOUPE est présente ou absente/);
  assert.equal(
    ecran.split('Une VITRE laisse passer').length - 1,
    2,
    'la règle est écrite deux fois : à l’entrée, puis sur demande',
  );
});

// Comportement : `t` accepte tout le reste d'un coup.
test('`t` accepte tout le reste d’un coup', async () => {
  const one = await model('emerald', { a: leaf(9), b: leaf(8), c: leaf(7) });
  const { summary } = await passe([one], ['t']);
  assert.equal(summary.answered, 3, 'les trois sont tranchées après une seule touche');
});

// Comportement : `q` arrête la passe en gardant ce qui est déjà répondu.
test('`q` arrête sans perdre les réponses données', async () => {
  const one = await model('bistro', { a: leaf(9), b: leaf(8) });
  const { summary } = await passe([one], ['d', 'q']);
  assert.equal(summary.answered, 1, 'ce qui était répondu est gardé');
  assert.equal((await sheetOf(one)).textures.b.cutout, null, 'le reste attend toujours');
});
