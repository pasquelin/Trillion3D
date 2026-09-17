/**
 * L'encodeur témoin de la coupe : il ne lance rien, il note. Ce que la carte paie entre deux noyaux
 * ne se compte pas en fils mais en COMMANDES — chaque passe de calcul et chaque copie hors passe
 * vide sa file et ses caches —, et deux fichiers de test tiennent ce contrat : `gpuDagLive.test.ts`
 * pour la liste que chaque noyau parcourt, `gpuDagEncode.test.ts` pour le nombre de commandes.
 */
import assert from 'node:assert/strict';
import type { encodeDagKernels } from './gpuDagEncode.ts';

/** `liste` : le décalage du compte de groupes armé avant le lancement, donc la liste parcourue. */
export type Lancement = { noyau: string; groupes: number | 'indirect'; liste?: number };
export type Copie = {
  de: string;
  decalage: number;
  vers: string;
  octets: number;
  enPasse: boolean;
};

export const LIVE = 1234,
  CAND = 3000,
  DRAWN = 4000;
/** Les nœuds de chaque étage : le majorant sur lequel la passe de ce niveau est lancée à plat. */
export const ETAGES = [2, 9, 40, 150, 600];

/** Un encodeur qui ne fait que noter : quel noyau, lancé à plat ou sur quelle liste. */
export function encodeurTemoin() {
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

export function ressources(residentCut: boolean, levelCount = 3, pageCount = 4096) {
  const base = {
    residentCut,
    pageCount,
    nodeCount: 64,
    worldCount: 2,
    blockCount: 64,
    levelCount,
    levelSizes: Uint32Array.from(ETAGES.slice(0, levelCount)),
    liveGroupsOffset: LIVE,
    candGroupsOffset: CAND,
    drawnGroupsOffset: DRAWN,
    work: { nom: 'work' },
    dispatchArgs: { nom: 'dispatchArgs' },
    bindGroup: {},
    levelPipelines: [
      { entryPoint: 'dagLevel0' },
      { entryPoint: 'dagLevel1' },
      { entryPoint: 'dagLevel2' },
    ],
  };
  for (const nom of PIPELINES)
    Object.assign(base, {
      [`${nom}Pipeline`]: { entryPoint: `dag${nom[0].toUpperCase()}${nom.slice(1)}` },
    });
  return base as unknown as Parameters<typeof encodeDagKernels>[1];
}
