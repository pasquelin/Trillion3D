import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// LE TABLEAU DE PARITÉ NE DOIT PAS ROUILLER.
//
// `docs/REFERENCE_UE5.md` met les constantes de structure de la référence en regard des nôtres.
// Un tableau de ce genre ne vaut que tant que la colonne « chez nous » dit la vérité : le jour où
// une constante bouge dans le code sans que la ligne bouge, le document devient une affirmation
// fausse sur l'état du moteur, et personne ne le voit. Ce test relit les constantes à la source et
// refuse cet écart. Il ne juge PAS la colonne « la référence » — celle-là tient à ses sources,
// citées en bas du document — ni les millisecondes, qui ne sont pas des constantes.

const racine = new URL('../../', import.meta.url);
const doc = new URL('docs/REFERENCE_UE5.md', racine);
const sources = new URL('packages/asset-compiler-rust/src/', racine);

const UNITES = { Kio: 1024, Mio: 1024 * 1024 };

const nombre = (cellule) => {
  const trouve = /^([\d\u202f\u00a0 ]+)(?:\s+(Kio|Mio))?$/u.exec(cellule.trim());
  if (!trouve) return null;
  const brut = Number(trouve[1].replaceAll(/[\u202f\u00a0 ]/gu, ''));
  if (!Number.isFinite(brut)) return null;
  return brut * (trouve[2] ? UNITES[trouve[2]] : 1);
};

// Les lignes vérifiables du tableau : celles dont la colonne « preuve » nomme `fichier:CONSTANTE`.
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

// `pub const NAME: usize = 128 * 1024;` — produits d'entiers seulement, rien à évaluer d'autre.
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

test('chaque constante de structure du tableau de parité est celle du code', async () => {
  const lignes = lignesVerifiables(await readFile(doc, 'utf8'));
  // Sans ce plancher, une expression régulière cassée rendrait un tableau vide, donc un test vert
  // qui ne vérifie rien. Le compte n'a pas à être exact : il a à ne pas s'effondrer en silence.
  assert.ok(
    lignes.length >= 5,
    `docs/REFERENCE_UE5.md : ${lignes.length} ligne(s) vérifiable(s), le tableau en portait six`,
  );
  const textes = new Map();
  for (const { grandeur, attendu, fichier, constante } of lignes) {
    assert.notEqual(attendu, null, `${grandeur} : la colonne « chez nous » n'est pas un nombre`);
    if (!textes.has(fichier))
      textes.set(fichier, await readFile(new URL(fichier, sources), 'utf8'));
    const valeur = valeurConstante(textes.get(fichier), constante);
    assert.notEqual(valeur, null, `${fichier} : ${constante} introuvable ou non littérale`);
    assert.equal(
      valeur,
      attendu,
      `${grandeur} : ${constante} vaut ${valeur}, le tableau dit ${attendu}`,
    );
  }
});

// Les trois écarts que le §1 déclare sont des faits sur le code, pas des opinions : le jour où l'un
// d'eux est corrigé, le document ment dans l'autre sens. Le test tient donc aussi ce côté-là.
test('les écarts déclarés au tableau de parité sont encore vrais', async () => {
  const texte = await readFile(doc, 'utf8');
  const groupes = await readFile(new URL('dag/groups.rs', sources), 'utf8');
  const lib = await readFile(new URL('lib.rs', sources), 'utf8');
  if (texte.includes('Le plancher de groupe n’est pas appliqué')) {
    assert.doesNotMatch(
      groupes,
      /DAG_GROUP_MIN/u,
      'dag/groups.rs applique désormais le plancher : retirer cet écart de docs/REFERENCE_UE5.md',
    );
  }
  if (texte.includes('`CLUSTER_TRIANGLES = 256` vit encore')) {
    assert.match(
      lib,
      /pub const CLUSTER_TRIANGLES:\s*usize\s*=\s*256;/u,
      'la constante morte a disparu : retirer cet écart de docs/REFERENCE_UE5.md',
    );
  }
});
