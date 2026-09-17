// La coupe ne visite plus aucune grappe à plat : la descente par niveaux se répartit sur la file que
// le niveau précédent a remplie, `dagWanted` sur les seules pages candidates, et les noyaux qui le
// suivent sur la liste des grappes vivantes. Ce fichier tient la liste que chaque noyau parcourt ;
// `gpuDagEncode.test.ts` tient le nombre de commandes qu'une image ouvre.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeDagKernels } from './gpuDagEncode.ts';
import { DAG_SELECTION_SHADER } from './gpuDagSelection.ts';
import { ESCALATION_ROUNDS } from './pageSelectionTypes.ts';
import { encodeurTemoin, ressources, ETAGES, LIVE, CAND } from './gpuDagEncodeFixture.ts';

test('chaque noyau de la coupe se répartit sur la liste que le précédent a remplie', () => {
  const { encoder, lancements } = encodeurTemoin();
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, ressources(true));
  const parNoyau = new Map(lancements.map((l) => [l.noyau, l]));
  // Les grappes vivantes : le verdict d'avant, prononcé sur elles seules.
  for (const noyau of ['dagEscalate', 'dagCheck', 'dagMask', 'dagDrawScatter']) {
    assert.equal(parNoyau.get(noyau)?.groupes, 'indirect', `${noyau} suit une liste`);
    assert.equal(parNoyau.get(noyau)?.liste, LIVE, `${noyau} suit la liste des vivantes`);
  }
  // Les pages candidates, et elles seules : une page sous un nœud rejeté n'est plus lue.
  assert.equal(parNoyau.get('dagWanted')?.liste, CAND);
  // La descente : la passe 0 part des racines, d'un compte connu du rangement, et chaque niveau
  // suivant du nombre de nœuds de son étage — connu du rangement lui aussi. Aucune indirection, donc
  // aucune recopie d'argument, et aucun niveau ne visite la hiérarchie entière.
  assert.deepEqual(lancements.slice(2, 5), [
    { noyau: 'dagLevel0', groupes: 1 },
    { noyau: 'dagLevel1', groupes: Math.ceil(ETAGES[1] / 64) },
    { noyau: 'dagLevel2', groupes: Math.ceil(ETAGES[2] / 64) },
  ]);
  const ordre = lancements.map((l) => l.noyau);
  assert.ok(ordre.indexOf('dagWanted') > ordre.lastIndexOf('dagLevel2'));
  assert.ok(ordre.indexOf('dagEscalate') > ordre.indexOf('dagWanted'));
  // Le compte lancé à plat est celui des primitives, des blocs ou d'un étage de la hiérarchie :
  // jamais celui des grappes.
  const plats = lancements.filter((l) => l.groupes !== 'indirect').map((l) => l.noyau);
  assert.deepEqual(plats, ['dagPrepare', 'dagLevel0', 'dagLevel1', 'dagLevel2', 'dagDrawPrefix']);
});

test("l'attente entre lancements ne dépend que de la profondeur, pas du nombre de grappes", () => {
  const { encoder, lancements } = encodeurTemoin();
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, ressources(true));
  // Effacement du journal, préparation, une passe par niveau, les candidates, trois escalades, la
  // vérification, le masque, le préfixe et la compaction.
  assert.equal(lancements.length, ESCALATION_ROUNDS + 7 + 3);
  const noyaux = lancements.map((l) => l.noyau);
  assert.ok(!noyaux.includes('dagArgs') && !noyaux.includes('dagDrawCount'));
  assert.equal(noyaux[0], 'dagClearDrawn');
  assert.equal(noyaux[1], 'dagPrepare');
  // La préparation couvre à la fois les primitives et les blocs de la compaction.
  assert.equal(lancements[1].groupes, 1);
  // Seize fois plus de grappes, autant de lancements : c'est la profondeur qui les compte.
  const large = encodeurTemoin();
  encodeDagKernels(large.encoder as unknown as GPUCommandEncoder, ressources(true, 3, 65536));
  assert.equal(large.lancements.length, lancements.length);
  // Un niveau de plus, un lancement de plus.
  const profond = encodeurTemoin();
  encodeDagKernels(profond.encoder as unknown as GPUCommandEncoder, ressources(true, 4));
  assert.equal(profond.lancements.length, lancements.length + 1);
});

test('sans coupe résidente, le masque suit la liste et les escalades ne sont pas encodées', () => {
  const { encoder, lancements } = encodeurTemoin();
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, ressources(false));
  const noyaux = lancements.map((l) => l.noyau);
  assert.ok(!noyaux.includes('dagEscalate') && !noyaux.includes('dagCheck'));
  assert.ok(!noyaux.includes('dagDrawPrefix') && !noyaux.includes('dagDrawScatter'));
  const masque = lancements.find((l) => l.noyau === 'dagMask');
  assert.equal(masque?.groupes, 'indirect');
  assert.equal(masque?.liste, LIVE);
  // La descente, elle, est encodée dans les deux cas : elle ne dépend pas de la résidence.
  assert.ok(noyaux.includes('dagLevel0') && noyaux.includes('dagLevel1'));
  assert.ok(noyaux.includes('dagLevel2'));
});

test('les noyaux de la liste lisent leur grappe dans la liste, pas dans leur identifiant de fil', () => {
  // Le rejet que ces noyaux faisaient eux-mêmes — `visible` — a disparu de leur corps : une grappe
  // absente de la liste est exactement une grappe dont `visible` était faux.
  for (const noyau of ['dagEscalate', 'dagCheck', 'dagMask']) {
    const corps = DAG_SELECTION_SHADER.split(`fn ${noyau}(`)[1].split('\n}')[0];
    assert.match(corps, /let i=liveAt\(s\);/, `${noyau} lit la liste`);
    assert.doesNotMatch(corps, /visible\(/, `${noyau} ne refait pas le rejet`);
  }
});
