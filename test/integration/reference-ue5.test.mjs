import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// THE PARITY TABLE MUST NOT RUST.
//
// `docs/REFERENCE_UE5.md` puts reference structural constants side by side with ours.
// A table of this kind is only valuable as long as "our side" column tells the truth: the day
// a constant changes in code without the row changing, the document becomes a false statement
// about the engine state, and nobody notices. This test re-reads constants at source and
// rejects this deviation. It does NOT judge "the reference" column — which relies on its sources,
// cited at document bottom — nor milliseconds, which are not constants.

const racine = new URL('../../', import.meta.url);
const doc = new URL('docs/REFERENCE_UE5.md', racine);
const sources = new URL('packages/asset-compiler-rust/src/', racine);

const UNITES = { KiB: 1024, MiB: 1024 * 1024 };

const nombre = (cellule) => {
  const trouve = /^([\d\u202f\u00a0 ]+)(?:\s+(KiB|MiB))?$/u.exec(cellule.trim());
  if (!trouve) return null;
  const brut = Number(trouve[1].replaceAll(/[\u202f\u00a0 ]/gu, ''));
  if (!Number.isFinite(brut)) return null;
  return brut * (trouve[2] ? UNITES[trouve[2]] : 1);
};

// Verifiable table rows: those whose "proof" column names `file:CONSTANT`.
const lignesVerifiables = (texte) =>
  texte
    .split('\n')
    .filter((ligne) => ligne.startsWith('|'))
    .map((ligne) => ligne.split('|').map((cellule) => cellule.trim()))
    .filter((cellules) => cellules.length === 6)
    .map(([, grandeur, , notre, preuve]) => {
      const cible = /^`([\w/.]+\.rs):([A-Z][A-Z\d_]*)`$/u.exec(preuve);
      return cible && { grandeur, attendu: nombre(notre), fichier: cible[1], constante: cible[2] };
    })
    .filter(Boolean);

// `pub const NAME: usize = 128 * 1024;` — integer products only, nothing else to evaluate.
const valeurConstante = (texte, constante) => {
  const trouve = new RegExp(String.raw`pub const ${constante}:\s*\w+\s*=\s*([^;]+);`, 'u').exec(
    texte,
  );
  if (!trouve) return null;
  const expression = trouve[1].trim();
  if (!/^\d+(?:\s*\*\s*\d+)*$/u.test(expression)) return null;
  return expression
    .split('*')
    .map((facteur) => Number(facteur.trim()))
    .reduce((produit, facteur) => produit * facteur, 1);
};

test('each structural constant in the parity table matches the code', async () => {
  const lignes = lignesVerifiables(await readFile(doc, 'utf8'));
  // Without this threshold, a broken regex would yield an empty array, thus a passing test
  // verifying nothing. The count does not need to be exact: it must not collapse silently.
  assert.ok(
    lignes.length >= 5,
    `docs/REFERENCE_UE5.md: ${lignes.length} verifiable line(s), the table used to carry six`,
  );
  const textes = new Map();
  for (const { grandeur, attendu, fichier, constante } of lignes) {
    assert.notEqual(attendu, null, `${grandeur}: the "us" column is not a number`);
    if (!textes.has(fichier))
      textes.set(fichier, await readFile(new URL(fichier, sources), 'utf8'));
    const valeur = valeurConstante(textes.get(fichier), constante);
    assert.notEqual(valeur, null, `${fichier}: ${constante} missing or not a literal`);
    assert.equal(
      valeur,
      attendu,
      `${grandeur}: ${constante} is ${valeur}, the table says ${attendu}`,
    );
  }
});

// The nuances declared in §1 are code facts, not opinions: the day one is fixed, the document
// lies in the other direction. Each is checked both ways, so a reworded sentence cannot silently
// skip the check: the nuance is declared exactly when the code still carries it.
test('nuances declared in the parity table are still true, and only those', async () => {
  const texte = await readFile(doc, 'utf8');
  const groupes = await readFile(new URL('dag/groups.rs', sources), 'utf8');
  const lib = await readFile(new URL('lib.rs', sources), 'utf8');
  assert.equal(
    texte.includes('**Group floor is not enforced.**'),
    !/DAG_GROUP_MIN/u.test(groupes),
    'docs/REFERENCE_UE5.md and dag/groups.rs disagree on whether the group floor is enforced',
  );
  assert.equal(
    texte.includes('**`CLUSTER_TRIANGLES = 256` remains in `lib.rs`**'),
    /pub const CLUSTER_TRIANGLES:\s*usize\s*=\s*256;/u.test(lib),
    'docs/REFERENCE_UE5.md and lib.rs disagree on whether the dead 256 constant remains',
  );
});
