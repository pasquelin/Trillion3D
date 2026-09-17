import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSheet, pendingOf, answerSheet, SHEET_FILE } from './cutoutSheet.mts';

const leaf = {
  image: 'feuillage.png',
  used: true,
  measure: { betweenPercent: 4.3 },
  blendPrimitives: 3,
  proposal: 'cutout',
  cutout: null,
};
const glass = {
  image: 'vitre.png',
  used: true,
  blendPrimitives: 1,
  proposal: 'blend',
  cutout: null,
};

async function model(sheet) {
  const directory = await mkdtemp(join(tmpdir(), 'wg-feuille-'));
  await writeFile(join(directory, SHEET_FILE), JSON.stringify(sheet));
  return directory;
}

// Comportement : une texture partagée par deux modèles ne fait qu'une ligne — la réponse porte sur
// les octets de l'image —, et ce qu'elle tient de primitives en mélange s'additionne.
test('une image partagée ne fait qu’une ligne, et ses primitives s’additionnent', () => {
  const pending = pendingOf(
    new Map([
      ['emerald', { version: 1, textures: { abc: { ...leaf }, def: { ...glass } } }],
      ['bistro', { version: 1, textures: { abc: { ...leaf, blendPrimitives: 5 } } }],
    ]),
  );
  assert.equal(pending.length, 2);
  assert.deepEqual(
    pending.map((one) => [one.image, one.blendPrimitives, one.models]),
    [
      ['feuillage.png', 8, ['emerald', 'bistro']],
      ['vitre.png', 1, ['emerald']],
    ],
  );
  assert.equal(pending[0].proposal, true, 'la proposition voyage avec la ligne');
});

// Comportement : ce qui est déjà tranché, et ce que le modèle n'emploie plus, ne se redemande pas.
test('une texture déjà tranchée ou inutilisée ne se redemande pas', () => {
  const textures = {
    abc: { ...leaf, cutout: true },
    def: { ...leaf, cutout: false },
    ghi: { ...leaf, used: false },
    jkl: { ...leaf },
  };
  const pending = pendingOf(new Map([['emerald', { version: 1, textures }]]));
  assert.deepEqual(
    pending.map((one) => one.sha256),
    ['jkl'],
  );
});

// Comportement : la réponse n'entre que dans les feuilles qui connaissent la texture. Une réponse
// portant sur une image qu'un modèle n'emploie pas ne l'invente pas dans sa feuille.
test('la réponse n’entre que dans les feuilles qui connaissent la texture', async () => {
  const directory = await model({ version: 1, textures: { abc: { ...leaf } } });
  const sheet = await readSheet(directory);
  const changed = await answerSheet(
    directory,
    sheet,
    new Map([
      ['abc', true],
      ['zzz', true],
    ]),
  );
  assert.equal(changed, true);
  const written = JSON.parse(await readFile(join(directory, SHEET_FILE), 'utf8'));
  assert.equal(written.textures.abc.cutout, true);
  assert.equal(written.textures.zzz, undefined);
  assert.equal(
    await answerSheet(directory, written, new Map([['abc', true]])),
    false,
    'une réponse qui ne change rien ne réécrit rien',
  );
});

// Comportement : une feuille d'une version inconnue est refusée plutôt que devinée, et un modèle
// sans feuille n'a simplement rien à trancher.
test('une feuille inconnue est refusée, une feuille absente ne dit rien', async () => {
  const directory = await model({ version: 99, textures: {} });
  await assert.rejects(() => readSheet(directory), /version 99/);
  assert.equal(await readSheet(await mkdtemp(join(tmpdir(), 'wg-vide-'))), null);
});
