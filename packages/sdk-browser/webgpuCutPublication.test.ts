// La publication d'une coupe processeur : elle ne fait vieillir les listes qu'une fois par image —
// celui qui oublie le relevé le fait avant de choisir, et couvre ainsi la sortie par erreur de la
// coupe — et republier la même coupe ne remue rien, puisque ce qui est publié est une différence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuCutPublication } from './webgpuCutPublication.ts';
import { fixturePages, fixtureUniforms } from './webgpuCutAdopterFixture.ts';
import type { CutDelta } from './webgpuCutDelta.ts';
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
  /** Ce que les ensembles de résidence ont réellement reçu : des différences, pas des listes. */
  const remue = { coupe: 0, dessinee: 0 };
  const compte = (delta: CutDelta) => delta.enteredCount + delta.exitedCount;
  const residencySets = {
    applyCut: (delta: CutDelta) => (remue.coupe += compte(delta)),
    applyDrawn: (delta: CutDelta) => (remue.dessinee += compte(delta)),
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
  return { publication, run, packedPages, remue };
}

test('une image de coupe processeur ne fait vieillir les listes qu’une fois', () => {
  const { publication, run, packedPages } = banc();
  const avant = run.cutEpoch;
  // L'ordre de `renderCpuCut` : oublier le relevé, choisir, puis publier une fois les gardes passées.
  publication.forgetReadback();
  publication.adoptCpuCut(packedPages.slice(0, 3), packedPages.slice(0, 2));
  assert.equal(run.cutEpoch, avant + 1, 'un seul vieillissement pour l’image');
  assert.deepEqual(
    run.desired.map((page) => (page as { url: string }).url),
    ['p0', 'p1', 'p2'],
  );
});

test('republier la même coupe ne remue aucun ensemble', () => {
  const { publication, packedPages, remue } = banc();
  publication.adoptCpuCut(packedPages.slice(0, 3), packedPages.slice(0, 2));
  const coupe = remue.coupe,
    dessinee = remue.dessinee;
  assert.ok(coupe > 0 && dessinee > 0, 'la première publication a bien nommé des pages');
  publication.adoptCpuCut(packedPages.slice(0, 3), packedPages.slice(0, 2));
  assert.equal(remue.coupe, coupe, 'la seconde ne fait entrer ni sortir une seule page');
  assert.equal(remue.dessinee, dessinee);
});
