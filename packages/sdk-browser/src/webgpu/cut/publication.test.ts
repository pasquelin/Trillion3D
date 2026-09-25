// Publication of a CPU cut: it only ages the lists once per image — whoever forgets the readback
// does it before choosing, and thus covers an erroneous exit of the cut — and republishing the
// same cut stirs nothing, since what is published is a difference.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts';
import { createWebgpuCutPublication } from './publication.ts';
import { fixturePages, fixtureUniforms } from './adopter.fixture.ts';
import type { CutDelta } from './delta.ts';
import type { WebgpuPagesCore } from '../pages/runtime.ts';
import type { WebgpuResidencySets } from '../residency/sets.ts';
import { createGroupClosure } from '../../page/cut/groupClosure.ts';

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
    hostBytes: 0,
  } as unknown as WebgpuResidencySets;
  const rt = {
    run,
    gpu: {},
    lights: {
      store: { count: 1 },
      plan: { representationChanged: (min: number[]) => shadowChanges.push(min[0]) },
    },
    layout: {
      packedPages,
      gpuWanted: [packedPages[0]],
      selectionRoots: [],
      rows: { watchTouched: () => {} },
    },
  } as unknown as WebgpuPagesCore;
  /** The two lower tiers, and every list handed to the tier ahead. */
  const aheadOffers: number[][] = [];
  const tiers = {
    shadow: { hostBytes: 0 },
    ahead: {
      hostBytes: 0,
      offerIds: (ids: ArrayLike<number>) => aheadOffers.push(Array.from(ids)),
    },
  };
  const publication = createWebgpuCutPublication(
    rt,
    residencySets,
    createGroupClosure([], packedPages),
    { all: [tiers.shadow, tiers.ahead], ahead: tiers.ahead },
  );
  return {
    publication,
    run,
    packedPages,
    remue,
    shadowChanges,
    tiers,
    aheadOffers,
    resourceChanges: () => resourceChanges,
  };
}

test('the CPU cut, which sees no view ahead, empties the tier ahead', () => {
  const { publication, packedPages, aheadOffers } = banc();
  publication.adoptCpuCut(packedPages.slice(0, 2), packedPages.slice(0, 2));
  assert.deepEqual(aheadOffers.at(-1), [], 'the last list ahead is empty');
});

test('both lower tiers count in the host tables', () => {
  const { publication, tiers } = banc();
  const before = publication.hostTableBytes();
  assert.ok(Number.isFinite(before), `every table reads a size (${before})`);
  tiers.shadow.hostBytes = 64;
  tiers.ahead.hostBytes = 32;
  assert.equal(publication.hostTableBytes(), before + 96);
});

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

test('the camera cut moving stales no shadow page: the maps draw what the light cuts select', () => {
  const { publication, packedPages, shadowChanges, resourceChanges } = banc();
  publication.adoptCpuCut(packedPages, [packedPages[0]]);
  publication.adoptCpuCut(packedPages, [packedPages[1]]);
  publication.adoptCpuCut(packedPages, [packedPages[0]]);
  assert.deepEqual(shadowChanges, [], 'no caster bound is declared for a camera cut change');
  assert.equal(resourceChanges(), 0, 'nor is the held frame woken for the shadows');
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
