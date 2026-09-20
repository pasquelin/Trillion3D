// Publication of a CPU cut: it only ages the lists once per image — whoever forgets the readback
// does it before choosing, and thus covers an erroneous exit of the cut — and republishing the
// same cut stirs nothing, since what is published is a difference.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4 } from 'three';
import { createWebgpuCutPublication } from './webgpuCutPublication.ts';
import { fixturePages, fixtureUniforms } from './webgpuCutAdopterFixture.ts';
import type { CutDelta } from './webgpuCutDelta.ts';
import type { WebgpuPagesCore } from './webgpuPagesRuntime.ts';
import type { WebgpuResidencySets } from './webgpuResidencySets.ts';

function banc() {
  const packedPages = fixturePages(4);
  for (let i = 0; i < packedPages.length; i++) {
    packedPages[i].matrix = new Matrix4().makeTranslation(i * 10, 0, 0);
    packedPages[i].min = [0, 0, 0];
    packedPages[i].max = [0, 0, 0];
  }
  const shadowChanges: number[] = [];
  let resourceChanges = 0;
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
    gate: { resourcesChanged: () => resourceChanges++ },
  };
  /** What the residency sets actually received: differences, not lists. */
  const remue = { coupe: 0, dessinee: 0 };
  const compte = (delta: CutDelta) => delta.enteredCount + delta.exitedCount;
  const residencySets = {
    applyCut: (delta: CutDelta) => (remue.coupe += compte(delta)),
    applyDrawn: (delta: CutDelta) => (remue.dessinee += compte(delta)),
  } as unknown as WebgpuResidencySets;
  const rt = {
    run,
    gpu: {},
    lights: {
      store: { count: 1 },
      plan: { worldChanged: (min: number[]) => shadowChanges.push(min[0]) },
    },
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
  return {
    publication,
    run,
    packedPages,
    remue,
    shadowChanges,
    resourceChanges: () => resourceChanges,
  };
}

test('a CPU-cut image only ages the lists once', () => {
  const { publication, run, packedPages } = banc();
  const avant = run.cutEpoch;
  // Order of `renderCpuCut`: forget the readback, choose, then publish once the guards have passed.
  publication.forgetReadback();
  publication.adoptCpuCut(packedPages.slice(0, 3), packedPages.slice(0, 2));
  assert.equal(run.cutEpoch, avant + 1, 'a single ageing for the image');
  assert.deepEqual(
    run.desired.map((page) => (page as { url: string }).url),
    ['p0', 'p1', 'p2'],
  );
});

test('resident cut changes invalidate old and new caster bounds and wake the held frame', () => {
  const { publication, packedPages, shadowChanges, resourceChanges } = banc();
  publication.adoptCpuCut(packedPages, [packedPages[0]]);
  assert.deepEqual(shadowChanges, [0]);
  publication.adoptCpuCut(packedPages, [packedPages[1]]);
  assert.deepEqual(
    shadowChanges,
    [0, 0, 10],
    'both departing and arriving casters are invalidated',
  );
  publication.adoptCpuCut(packedPages, [packedPages[0]]);
  assert.deepEqual(
    shadowChanges,
    [0, 0, 10, 10, 0],
    'returning to a resident cut also invalidates',
  );
  assert.equal(resourceChanges(), 3);
  publication.adoptCpuCut(packedPages, [packedPages[0]]);
  assert.equal(shadowChanges.length, 5, 'an unchanged cut produces no shadow work');
  assert.equal(resourceChanges(), 3, 'an unchanged cut does not wake the frame');
});

test('republishing the same cut stirs no set', () => {
  const { publication, packedPages, remue } = banc();
  publication.adoptCpuCut(packedPages.slice(0, 3), packedPages.slice(0, 2));
  const coupe = remue.coupe,
    dessinee = remue.dessinee;
  assert.ok(coupe > 0 && dessinee > 0, 'the first publication did name pages');
  publication.adoptCpuCut(packedPages.slice(0, 3), packedPages.slice(0, 2));
  assert.equal(remue.coupe, coupe, 'the second neither enters nor exits a single page');
  assert.equal(remue.dessinee, dessinee);
});
