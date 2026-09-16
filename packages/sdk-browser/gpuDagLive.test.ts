// La coupe ne visite plus toutes les grappes cinq fois : `dagWanted` liste les vivantes et compte
// leurs groupes de travail au fil des ajouts, et les cinq noyaux qui suivaient se répartissent sur
// cette liste seule. Ce fichier tient le contrat d'encodage qui le porte — dont le nombre de
// lancements, seul responsable de l'attente que les horodatages n'attribuent à aucun noyau.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeDagKernels } from './gpuDagEncode.ts';
import { DAG_SELECTION_SHADER } from './gpuDagSelection.ts';
import { ESCALATION_ROUNDS } from './pageSelectionTypes.ts';

type Lancement = { noyau: string; groupes: number | 'indirect' };

/** Un encodeur qui ne fait que noter : quel noyau, lancé à plat ou par argument de répartition. */
function encodeurTemoin() {
  const lancements: Lancement[] = [];
  const copies: Array<{ de: string; decalage: number; vers: string; octets: number }> = [];
  const passes: string[] = [];
  let noyau = '';
  const pass = {
    setBindGroup() {},
    setPipeline(next: { entryPoint: string }) {
      noyau = next.entryPoint;
    },
    dispatchWorkgroups(groupes: number) {
      lancements.push({ noyau, groupes });
    },
    dispatchWorkgroupsIndirect(buffer: { nom: string }, decalage: number) {
      assert.equal(buffer.nom, 'liveArgs');
      assert.equal(decalage, 0);
      lancements.push({ noyau, groupes: 'indirect' });
    },
    end() {},
  };
  const encoder = {
    beginComputePass(descriptor: { label: string }) {
      passes.push(descriptor.label);
      return pass;
    },
    copyBufferToBuffer(
      de: { nom: string },
      decalage: number,
      vers: { nom: string },
      _cible: number,
      octets: number,
    ) {
      copies.push({ de: de.nom, decalage, vers: vers.nom, octets });
    },
  };
  return { encoder, lancements, copies, passes };
}

const PIPELINES = [
  'prepare',
  'node',
  'wanted',
  'escalate',
  'check',
  'mask',
  'drawPrefix',
  'drawScatter',
] as const;

function ressources(residentCut: boolean) {
  const base = {
    residentCut,
    pageCount: 4096,
    nodeCount: 64,
    worldCount: 2,
    blockCount: 64,
    liveGroupsOffset: 1234,
    work: { nom: 'work' },
    liveArgs: { nom: 'liveArgs' },
    bindGroup: {},
  };
  for (const nom of PIPELINES)
    Object.assign(base, {
      [`${nom}Pipeline`]: { entryPoint: `dag${nom[0].toUpperCase()}${nom.slice(1)}` },
    });
  return base as unknown as Parameters<typeof encodeDagKernels>[1];
}

test('les cinq noyaux de la coupe se répartissent sur la liste des grappes vivantes', () => {
  const { encoder, lancements } = encodeurTemoin();
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, ressources(true));
  const parNoyau = new Map(lancements.map((l) => [l.noyau, l.groupes]));
  for (const noyau of ['dagEscalate', 'dagCheck', 'dagMask'])
    assert.equal(parNoyau.get(noyau), 'indirect', `${noyau} suit la liste des vivantes`);
  // Les trois qui restent à plat visitent bien toutes les grappes : ce sont ceux qui les découvrent
  // (`dagWanted`) ou qui relisent un drapeau par grappe (la compaction).
  const groupes = Math.ceil(4096 / 64);
  assert.equal(parNoyau.get('dagWanted'), groupes);
  assert.equal(parNoyau.get('dagDrawScatter'), groupes);
  // Trois escalades, une vérification, un masque : l'ordre et le compte des lancements sont ceux
  // d'avant, seule leur taille change.
  const indirects = lancements.filter((l) => l.groupes === 'indirect');
  assert.equal(indirects.length, ESCALATION_ROUNDS + 2);
  const ordre = lancements.map((l) => l.noyau);
  assert.ok(ordre.indexOf('dagEscalate') > ordre.indexOf('dagWanted'));
});

test("l'attente entre lancements est bornée par leur nombre : dix, pas treize", () => {
  const { encoder, lancements } = encodeurTemoin();
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, ressources(true));
  // La préparation porte les seuils, les plans et les comptes de bloc ; le compte de groupes se
  // tient au fil des ajouts ; le masque compte les dessinées de son bloc. Trois lancements de moins.
  assert.equal(lancements.length, ESCALATION_ROUNDS + 7);
  const noyaux = lancements.map((l) => l.noyau);
  assert.ok(!noyaux.includes('dagArgs') && !noyaux.includes('dagDrawCount'));
  assert.equal(noyaux[0], 'dagPrepare');
  // La préparation couvre à la fois les primitives et les blocs de la compaction.
  assert.equal(lancements[0].groupes, 1);
});

test("l'argument de répartition est recopié hors passe, entre les deux passes de la coupe", () => {
  const { encoder, copies, passes } = encodeurTemoin();
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, ressources(true));
  // WebGPU refuse `work` à la fois en écriture et en argument dans une même portée : la coupure
  // entre les deux passes ne porte que ce mot, les deux autres valant un depuis la création.
  assert.deepEqual(copies, [{ de: 'work', decalage: 1234, vers: 'liveArgs', octets: 4 }]);
  assert.deepEqual(passes, ['WG DAG selection', 'WG DAG selection']);
});

test('sans coupe résidente, le masque suit la liste et les escalades ne sont pas encodées', () => {
  const { encoder, lancements } = encodeurTemoin();
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, ressources(false));
  const noyaux = lancements.map((l) => l.noyau);
  assert.ok(!noyaux.includes('dagEscalate') && !noyaux.includes('dagCheck'));
  assert.ok(!noyaux.includes('dagDrawScatter'));
  assert.equal(lancements.find((l) => l.noyau === 'dagMask')?.groupes, 'indirect');
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
