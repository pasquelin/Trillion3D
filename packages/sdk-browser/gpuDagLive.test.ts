// La coupe ne visite plus aucune grappe à plat : la descente par niveaux se répartit sur la file que
// le niveau précédent a remplie, `dagWanted` sur les seules pages candidates, et les noyaux qui le
// suivent sur la liste des grappes vivantes. Ce fichier tient le contrat d'encodage qui le porte —
// dont le nombre de lancements, seul responsable de l'attente que les horodatages n'attribuent à
// aucun noyau, et qui ne dépend plus que de la profondeur de la hiérarchie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeDagKernels } from './gpuDagEncode.ts';
import { DAG_SELECTION_SHADER } from './gpuDagSelection.ts';
import { ESCALATION_ROUNDS } from './pageSelectionTypes.ts';

/** `liste` : le décalage du compte de groupes armé avant le lancement, donc la liste parcourue. */
type Lancement = { noyau: string; groupes: number | 'indirect'; liste?: number };
type Copie = { de: string; decalage: number; vers: string; octets: number; enPasse: boolean };

const LIVE = 1234,
  RESET = [1996, 2004],
  QUEUE = [2000, 2008],
  CAND = 3000,
  DRAWN = 4000;

/** Un encodeur qui ne fait que noter : quel noyau, lancé à plat ou sur quelle liste. */
function encodeurTemoin() {
  const lancements: Lancement[] = [];
  const copies: Copie[] = [];
  const passes: string[] = [];
  let noyau = '';
  let arme = -1;
  let ouverte = false;
  const pass = {
    setBindGroup() {},
    setPipeline(next: { entryPoint: string }) {
      noyau = next.entryPoint;
    },
    dispatchWorkgroups(groupes: number) {
      lancements.push({ noyau, groupes });
    },
    dispatchWorkgroupsIndirect(buffer: { nom: string }, decalage: number) {
      assert.equal(buffer.nom, 'dispatchArgs');
      assert.equal(decalage, 0);
      lancements.push({ noyau, groupes: 'indirect', liste: arme });
    },
    end() {
      ouverte = false;
    },
  };
  const encoder = {
    beginComputePass(descriptor: { label: string }) {
      passes.push(descriptor.label);
      ouverte = true;
      return pass;
    },
    copyBufferToBuffer(
      de: { nom: string },
      decalage: number,
      vers: { nom: string },
      _cible: number,
      octets: number,
    ) {
      copies.push({ de: de.nom, decalage, vers: vers.nom, octets, enPasse: ouverte });
      if (vers.nom === 'dispatchArgs') arme = decalage;
    },
  };
  return { encoder, lancements, copies, passes };
}

const PIPELINES = [
  'prepare',
  'clearDrawn',
  'wanted',
  'escalate',
  'check',
  'mask',
  'drawPrefix',
  'drawScatter',
] as const;

function ressources(residentCut: boolean, levelCount = 3, pageCount = 4096) {
  const base = {
    residentCut,
    pageCount,
    nodeCount: 64,
    worldCount: 2,
    blockCount: 64,
    levelCount,
    liveGroupsOffset: LIVE,
    queueResetOffset: RESET,
    queueGroupsOffset: QUEUE,
    candGroupsOffset: CAND,
    drawnGroupsOffset: DRAWN,
    work: { nom: 'work' },
    zeros: { nom: 'zeros' },
    dispatchArgs: { nom: 'dispatchArgs' },
    bindGroup: {},
    levelPipelines: [{ entryPoint: 'dagLevel0' }, { entryPoint: 'dagLevel1' }],
  };
  for (const nom of PIPELINES)
    Object.assign(base, {
      [`${nom}Pipeline`]: { entryPoint: `dag${nom[0].toUpperCase()}${nom.slice(1)}` },
    });
  return base as unknown as Parameters<typeof encodeDagKernels>[1];
}

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
  // La descente : la passe 0 part des racines, d'un compte connu du rangement ; les suivantes de la
  // file en bascule que la précédente a remplie. Aucune ne visite la hiérarchie entière.
  assert.deepEqual(lancements.slice(2, 5), [
    { noyau: 'dagLevel0', groupes: 1 },
    { noyau: 'dagLevel1', groupes: 'indirect', liste: QUEUE[1] },
    { noyau: 'dagLevel0', groupes: 'indirect', liste: QUEUE[0] },
  ]);
  const ordre = lancements.map((l) => l.noyau);
  assert.ok(ordre.indexOf('dagWanted') > ordre.lastIndexOf('dagLevel0'));
  assert.ok(ordre.indexOf('dagEscalate') > ordre.indexOf('dagWanted'));
  // Seules la préparation, la passe 0 et le préfixe restent à plat : leur compte est celui des
  // primitives ou des blocs, jamais celui des grappes.
  const plats = lancements.filter((l) => l.groupes !== 'indirect').map((l) => l.noyau);
  assert.deepEqual(plats, ['dagPrepare', 'dagLevel0', 'dagDrawPrefix']);
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

test("l'argument de répartition est recopié hors passe, entre deux passes de la coupe", () => {
  const { encoder, copies, passes } = encodeurTemoin();
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, ressources(true));
  // WebGPU refuse `work` à la fois en écriture et en argument dans une même portée : chaque armement
  // coupe donc la passe, et ne porte que le mot de tête, les deux autres valant un depuis la
  // création. Les remises à zéro de compteur de file sortent par la même porte.
  assert.deepEqual(copies, [
    { de: 'work', decalage: DRAWN, vers: 'dispatchArgs', octets: 4, enPasse: false },
    { de: 'zeros', decalage: 0, vers: 'work', octets: 8, enPasse: false },
    { de: 'work', decalage: QUEUE[1], vers: 'dispatchArgs', octets: 4, enPasse: false },
    { de: 'zeros', decalage: 0, vers: 'work', octets: 8, enPasse: false },
    { de: 'work', decalage: QUEUE[0], vers: 'dispatchArgs', octets: 4, enPasse: false },
    { de: 'work', decalage: CAND, vers: 'dispatchArgs', octets: 4, enPasse: false },
    { de: 'work', decalage: LIVE, vers: 'dispatchArgs', octets: 4, enPasse: false },
  ]);
  assert.deepEqual(passes, new Array(5).fill('WG DAG selection'));
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
