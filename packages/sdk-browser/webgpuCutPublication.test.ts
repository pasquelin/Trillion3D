// La publication d'une coupe processeur : elle ne fait vieillir les listes qu'une fois par image —
// celui qui oublie le relevé le fait avant de choisir, et couvre ainsi la sortie par erreur de la
// coupe — et le repli épinglé, qui ne remplace que la liste montrée, ne republie pas la coupe
// demandée pour retomber dessus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuCutPublication } from './webgpuCutPublication.ts';
import { fixturePages, fixtureUniforms } from './webgpuCutAdopterFixture.ts';
import type { WebgpuPagesCore } from './webgpuPagesRuntime.ts';
import type { WebgpuResidencySets } from './webgpuResidencySets.ts';

function banc() {
  const packedPages = fixturePages(4);
  const run = {
    desired: [] as unknown[],
    shown: [] as unknown[],
    drawn: [] as unknown[],
    selectionUniforms: fixtureUniforms(),
    gpuSelection: undefined,
    cutEpoch: 0,
    cutHeld: false,
    pagesEntered: null,
    pagesExited: null,
  };
  const comptes = { coupe: 0, dessinee: 0 };
  const residencySets = {
    applyCut: () => comptes.coupe++,
    applyDrawn: () => comptes.dessinee++,
  } as unknown as WebgpuResidencySets;
  const rt = {
    run,
    gpu: {},
    layout: {
      packedPages,
      gpuWanted: [packedPages[0]],
      rows: {
        residentOffsetWords: new Int32Array(packedPages.length),
        watchTouched: () => {},
      },
    },
  } as unknown as WebgpuPagesCore;
  const publication = createWebgpuCutPublication(rt, residencySets);
  return { publication, run, packedPages, comptes };
}

test('une image de coupe processeur ne fait vieillir les listes qu’une fois', () => {
  const { publication, run, packedPages } = banc();
  const avant = run.cutEpoch;
  // L'ordre de `renderCpuCut` : oublier le relevé, choisir, publier, puis remplacer le montré.
  publication.forgetReadback();
  publication.adoptCpuCut(packedPages.slice(0, 3), packedPages.slice(0, 2));
  publication.adoptCpuDrawn(packedPages.slice(0, 1));
  assert.equal(run.cutEpoch, avant + 1, 'un seul vieillissement, quoi qu’il arrive ensuite');
});

test('le repli épinglé ne republie que la liste montrée', () => {
  const { publication, run, packedPages, comptes } = banc();
  publication.adoptCpuCut(packedPages.slice(0, 3), packedPages.slice(0, 2));
  const coupe = comptes.coupe,
    demandee = [...run.desired];
  publication.adoptCpuDrawn(packedPages.slice(0, 1));
  assert.equal(comptes.coupe, coupe, 'la coupe demandée n’est pas repassée');
  assert.equal(comptes.dessinee, 2, 'la liste montrée, elle, l’est');
  assert.deepEqual(run.desired, demandee, 'et elle n’a pas bougé d’un rang');
});
