import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rendreLesNoms,
  reecrireRapport,
  apparier,
  grouper,
  renommerLesNoeuds,
} from './graphify-libelles.mjs';

/** Un graphe minuscule : deux communautés, des liens qui donnent un nœud dominant. */
function graphe() {
  return {
    nodes: [
      { id: 'a', label: 'hiz.ts', community: 7, source_file: 'packages/sdk-browser/hiz.ts' },
      {
        id: 'b',
        label: 'hizDepth.ts',
        community: 7,
        source_file: 'packages/sdk-browser/hizDepth.ts',
      },
      {
        id: 'c',
        label: 'hizSplit.ts',
        community: 7,
        source_file: 'packages/sdk-browser/hizSplit.ts',
      },
      {
        id: 'x',
        label: 'png.rs',
        community: 3,
        source_file: 'packages/acr/src/plugins/image/png.rs',
      },
      { id: 'y', label: 'PNG', community: 3, source_file: 'packages/acr/src/plugins/image/png.rs' },
    ],
    links: [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'x', target: 'y' },
    ],
  };
}

test('un nom curé suit ses témoins même quand la communauté est renumérotée', () => {
  const temoins = { 'Pyramide Hi-Z et occlusion': ['a', 'b', 'c'] };
  const { libelles, repris } = rendreLesNoms(graphe(), temoins, process.cwd());
  assert.equal(repris, 1);
  assert.equal(libelles.get(7), 'Pyramide Hi-Z et occlusion');
});

test('une communauté sans témoin prend son dossier et son nœud dominant', () => {
  const { libelles } = rendreLesNoms(graphe(), {}, process.cwd());
  assert.equal(libelles.get(3), 'image · png');
});

test('un recouvrement trop faible ne vole pas le nom', () => {
  const temoins = { 'Décodage PNG': ['x', 'inconnu1', 'inconnu2', 'inconnu3', 'inconnu4'] };
  const { repris } = rendreLesNoms(graphe(), temoins, process.cwd());
  assert.equal(repris, 0);
});

test('deux communautés scindées ne portent pas le même nom', () => {
  const g = graphe();
  for (const n of g.nodes) n.community = n.id === 'x' || n.id === 'y' ? 3 : 7;
  const temoins = {};
  const { libelles } = rendreLesNoms(g, temoins, process.cwd());
  assert.notEqual(libelles.get(3), libelles.get(7));
});

test('le nom le plus franc est servi avant les autres', () => {
  const { groupes } = grouper(graphe());
  const apparies = apparier(groupes, { Faible: ['a', 'x', 'y'], Franc: ['a', 'b', 'c'] });
  assert.equal(apparies.get(7), 'Franc');
});

test('le rapport ne voit réécrire que ses titres de communauté', () => {
  const libelles = new Map([[7, 'Pyramide Hi-Z et occlusion']]);
  const avant = '### Community 7 - "hiz.ts"\nCohesion: 0.12\n### Community 9 - "autre"\n';
  const apres = reecrireRapport(avant, libelles);
  assert.match(apres, /### Community 7 - "Pyramide Hi-Z et occlusion"/);
  assert.match(apres, /### Community 9 - "autre"/);
  assert.match(apres, /Cohesion: 0\.12/);
});

test('le nom retourne dans chaque nœud, là où graphify query le lit', () => {
  const g = graphe();
  const libelles = new Map([
    [7, 'Pyramide Hi-Z et occlusion'],
    [3, 'Décodage PNG'],
  ]);
  assert.equal(renommerLesNoeuds(g, libelles), 5);
  assert.equal(g.nodes.find((n) => n.id === 'a').community_name, 'Pyramide Hi-Z et occlusion');
  assert.equal(g.nodes.find((n) => n.id === 'x').community_name, 'Décodage PNG');
  assert.equal(renommerLesNoeuds(g, libelles), 0);
});
