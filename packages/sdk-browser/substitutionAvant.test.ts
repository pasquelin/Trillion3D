// Ce que vaut la reconstruction de la forme d'avant un lot, dans les bancs de reproduction des
// défauts 6 et 9 (`bench/justesse/inverse-transposee-petite-echelle.mjs` et
// `normale-eclairage-petite-echelle.mjs`).
//
// L'ÉTAT D'AVANT, pour mémoire : les deux bancs reconstruisaient le shader d'avant par
// `texte.replace(INVERSE_TRANSPOSE_WGSL, INVERSE_TRANSPOSE_AVANT_WGSL)`, gardé par un seul
// `assert.notEqual(resultat, texte)`. Ce garde attrape le cas où le bloc livré n'est plus trouvé —
// donc la substitution n'était pas un silence complet — mais il ne dit que « quelque chose a
// bougé » : il laisse passer une substitution partielle (bloc livré présent deux fois, seule la
// première remplacée) et une substitution de travers (`$&`, `` $` ``, `$'`, `$$` interprétés dans
// le remplacement). Dans les deux cas le banc rejoue un shader qui n'est PAS celui d'avant le lot,
// et conclut sur lui.
//
// `substitutionAvant.mjs` remplace ce garde par une preuve. Ce test tient ses messages d'échec :
// une substitution qui ne se produit pas doit dire lequel des cas on est, et où aller.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DAG_SELECTION_SHADER } from './gpuDagShader.ts';
import { INVERSE_TRANSPOSE_AVANT_WGSL, INVERSE_TRANSPOSE_WGSL } from './inverseTransposeWgsl.ts';
import { NORMAL_TRANSFORM_WGSL } from './standardLighting.ts';
import { substitueFormeAvant } from './bench/justesse/substitutionAvant.mjs';

const ORIGINE = 'packages/sdk-browser/inverseTransposeWgsl.ts';
const SEUIL_ABSOLU = 'abs(det)<1e-20';
const reel = (texte: string, nom: string) => ({
  texte,
  livre: INVERSE_TRANSPOSE_WGSL,
  avant: INVERSE_TRANSPOSE_AVANT_WGSL,
  nom,
  origine: ORIGINE,
  marqueur: SEUIL_ABSOLU,
});

test('sur les deux nuanceurs réels, la substitution rend bien la forme d’avant le lot', () => {
  for (const [nom, texte] of [
    ['sélection du DAG', DAG_SELECTION_SHADER],
    ['éclairage', NORMAL_TRANSFORM_WGSL],
  ] as const) {
    const avant = substitueFormeAvant(reel(texte, nom));
    assert.ok(avant.includes(SEUIL_ABSOLU), `${nom} : le seuil absolu n’est pas revenu`);
    assert.ok(!texte.includes(SEUIL_ABSOLU), `${nom} : le texte livré porte encore le seuil`);
    assert.equal(
      avant.length,
      texte.length - INVERSE_TRANSPOSE_WGSL.length + INVERSE_TRANSPOSE_AVANT_WGSL.length,
    );
  }
});

/** L'appel doit lever, et le message doit contenir ce fragment-là. */
function echoue(options: Parameters<typeof substitueFormeAvant>[0], fragment: string) {
  assert.throws(
    () => substitueFormeAvant(options),
    (erreur: Error) => {
      assert.ok(
        erreur.message.includes(fragment),
        `message sans « ${fragment} » : ${erreur.message}`,
      );
      assert.ok(erreur.message.includes(ORIGINE), `message sans l’origine : ${erreur.message}`);
      return true;
    },
  );
}

test('le bloc livré introuvable : le banc s’arrête au lieu de rejouer le texte corrigé', () => {
  // Le cas qui compte : le noyau a bougé et la constante d'avant ne lui correspond plus. Sans
  // garde, `replace` rend le texte inchangé et le banc mesure la version CORRIGÉE des deux côtés.
  echoue(
    { ...reel(DAG_SELECTION_SHADER, 'shader sans le bloc'), livre: 'fn jamaisEcrite(){}' },
    'apparaît 0 fois',
  );
});

test('le bloc livré présent deux fois : la substitution serait partielle', () => {
  echoue(
    reel(`${DAG_SELECTION_SHADER}\n${INVERSE_TRANSPOSE_WGSL}`, 'shader au bloc doublé'),
    'apparaît 2 fois',
  );
});

test('un « $ » dans la forme d’avant : le remplacement nu se recolle de travers, pas celui-ci', () => {
  // `$&` vaut le texte apparié : un `replace(livre, avant)` nu recolle ici le bloc LIVRÉ dans le
  // « shader d'avant », qui rejoue alors la version corrigée au beau milieu du défaut. Le
  // remplacement par fonction, lui, ne lit aucun `$`.
  const avecDollar = `${INVERSE_TRANSPOSE_AVANT_WGSL}\n// $&`;
  const naif = DAG_SELECTION_SHADER.replace(INVERSE_TRANSPOSE_WGSL, avecDollar);
  assert.ok(naif.includes(INVERSE_TRANSPOSE_WGSL), 'le replace nu n’a pas interprété « $& »');
  const sain = substitueFormeAvant({
    ...reel(DAG_SELECTION_SHADER, 'forme d’avant avec $&'),
    avant: avecDollar,
  });
  assert.ok(
    !sain.includes(INVERSE_TRANSPOSE_WGSL),
    'le bloc livré est resté dans le shader d’avant',
  );
  assert.ok(sain.includes('// $&'), 'le « $& » doit rester le texte qu’il est');
  assert.equal(
    sain.length,
    DAG_SELECTION_SHADER.length - INVERSE_TRANSPOSE_WGSL.length + avecDollar.length,
  );
});

test('une forme d’avant qui ne porte plus le marqueur ne reproduit plus rien', () => {
  echoue(
    { ...reel(DAG_SELECTION_SHADER, 'forme d’avant sans seuil'), avant: INVERSE_TRANSPOSE_WGSL },
    'les deux blocs sont le même texte',
  );
  echoue(
    {
      ...reel(DAG_SELECTION_SHADER, 'forme d’avant édulcorée'),
      avant: INVERSE_TRANSPOSE_AVANT_WGSL.replace(SEUIL_ABSOLU, 'abs(det)<1e-30'),
    },
    `ne porte plus « ${SEUIL_ABSOLU} »`,
  );
});

test('la forme d’avant déjà présente dans le texte : ce n’est plus une reproduction', () => {
  const dejaAvant = DAG_SELECTION_SHADER.replace(
    INVERSE_TRANSPOSE_WGSL,
    () => INVERSE_TRANSPOSE_AVANT_WGSL,
  );
  echoue(reel(dejaAvant, 'shader déjà revenu en arrière'), 'apparaît 0 fois');
});
