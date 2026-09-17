// `verifieJeuInstructions` refuse tout module qui ne porte pas `simd128`, ou qui porte une capacité
// « relaxed » — la seule famille d'instructions WebAssembly à arrondi non garanti, qui casserait
// l'égalité bit à bit des noyaux de `packages/page-codec-wasm/src/math.rs`. Chaque cas est un module
// WebAssembly factice minimal (en-tête + une section personnalisée `target_features`), sans passer
// par `cargo build` : l'import de ce script ne le déclenche jamais (`main()` ne joue qu'en CLI).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifieJeuInstructions } from './build-wasm.mjs';

/** Un entier non signé en LEB128, comme l'exigent les longueurs du format binaire WebAssembly. */
function leb128(n) {
  const octets = [];
  do {
    let octet = n & 0x7f;
    n >>>= 7;
    if (n) octet |= 0x80;
    octets.push(octet);
  } while (n);
  return octets;
}

/**
 * Un module WebAssembly minimal valide — en-tête seul — portant une unique section personnalisée
 * `target_features` dont le contenu est le texte donné : exactement ce que lit
 * `verifieJeuInstructions`, sans dépendre d'un vrai encodage de capacités.
 */
function moduleFactice(texteCapacites) {
  const entete = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  const nom = Buffer.from('target_features', 'utf8');
  const charge = Buffer.from(texteCapacites, 'latin1');
  const corps = [...leb128(nom.length), ...nom, ...charge];
  return Buffer.from([...entete, 0x00, ...leb128(corps.length), ...corps]);
}

function fichierFactice(dir, texteCapacites) {
  const chemin = join(dir, 'factice.wasm');
  writeFileSync(chemin, moduleFactice(texteCapacites));
  return chemin;
}

test('un module avec simd128 et sans capacité relaxed est accepté', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wg-build-wasm-'));
  try {
    assert.doesNotThrow(() => verifieJeuInstructions(fichierFactice(dir, '+simd128')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('un module sans simd128 est refusé', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wg-build-wasm-'));
  try {
    assert.throws(
      () => verifieJeuInstructions(fichierFactice(dir, '+multivalue')),
      /simd128 absent/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('un module portant relaxed-simd est refusé même avec simd128', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wg-build-wasm-'));
  try {
    assert.throws(
      () => verifieJeuInstructions(fichierFactice(dir, '+simd128+relaxed-simd')),
      /capacité « relaxed » présente/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("importer le script n'exécute pas la compilation", () => {
  // Si `main()` s'exécutait à l'import, ce test échouerait bien avant d'arriver ici : `cargo`
  // n'est pas garanti installé sur la machine qui fait tourner `pnpm test`.
  assert.equal(typeof verifieJeuInstructions, 'function');
});
