import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CUTOUT_SHEET_FILE, CUTOUT_SHEET_VERSION } from '../../packages/sdk-core/index.ts';

/**
 * La feuille de réponses des découpes est le seul format que les deux langages ÉCRIVENT tous les
 * deux : le compilateur la produit et la relit, un hôte la réécrit avec les réponses d'un humain.
 * Une dérive entre les deux ne casserait rien au build — elle ferait refuser la feuille au prochain
 * import, ou pire, appliquerait des réponses lues de travers. Le test relit donc les constantes
 * dans le Rust, comme un lecteur extérieur, au lieu de les emprunter.
 */
const RUST = new URL('../../packages/asset-compiler-rust/src/cutout.rs', import.meta.url);

test('le nom et la version de la feuille sont les mêmes des deux côtés', async () => {
  const source = await readFile(RUST, 'utf8');
  const file = source.match(/DECISIONS_FILE: &str = "([^"]+)"/u);
  const version = source.match(/SHEET_VERSION: u64 = (\d+)/u);
  assert.ok(file, 'le compilateur nomme toujours sa feuille');
  assert.ok(version, 'le compilateur versionne toujours sa feuille');
  assert.equal(
    file[1],
    CUTOUT_SHEET_FILE,
    'le nom de la feuille a bougé côté compilateur sans bouger dans les contrats',
  );
  assert.equal(
    Number(version[1]),
    CUTOUT_SHEET_VERSION,
    'la version de la feuille a bougé côté compilateur sans bouger dans les contrats',
  );
});
