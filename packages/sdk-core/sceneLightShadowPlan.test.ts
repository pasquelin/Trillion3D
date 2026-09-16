// Une lampe retirée du magasin doit rendre sa tranche d'ombre et ses cellules d'atlas au `plan()`
// suivant — jamais avant, jamais après. `createShadowRelease` (sceneLightShadowRelease.ts) est
// l'unique voie de libération : ces tests la traversent par le seul chemin public, `plan()`, sans
// jamais l'appeler directement, exactement comme le moteur le fait.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from './sceneLightStore.ts';
import { createShadowPlan } from './sceneLightShadowPlan.ts';
import { RECTS_PER_SLICE } from './sceneLightShadowSlices.ts';
import { MAX_SHADOW_SLICES, type SceneLight, type ShadowViewpoint } from './sceneLightContracts.ts';

const VIEW: ShadowViewpoint = {
  position: [0, 0, 0],
  forward: [0, 0, -1],
  halfFovY: 0.9,
  aspect: 1,
  near: 0.1,
  far: 100,
};

/** Une ponctuelle à ombre, toutes identiques : même couverture d'écran, même tranche demandée. */
function pointLight(id: string): SceneLight {
  return {
    id,
    kind: 'point',
    position: [0, 0, -5],
    color: [1, 1, 1],
    intensity: 1,
    range: 5,
    castsShadow: true,
  };
}

function freeSlices(plan: ReturnType<typeof createShadowPlan>) {
  let free = 0;
  for (let slice = 0; slice < MAX_SHADOW_SLICES; slice++) if (!plan.slices.taken[slice]) free++;
  return free;
}

test('retirer une lampe à ombre rend sa tranche et ses cellules d’atlas au plan() suivant', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(64);
  store.add(pointLight('l0'));
  plan.plan(store, VIEW, 0, 0);

  const slice = store.sliceOf(store.slotOf('l0'));
  assert.ok(slice >= 0, 'la lampe a bien obtenu une tranche à la première image');
  assert.equal(plan.slices.taken[slice], 1);
  assert.ok(plan.slices.atlas.occupancy().used > 0, 'des cellules d’atlas sont prises');

  store.remove('l0');
  plan.plan(store, VIEW, 1, 16);

  assert.equal(plan.slices.taken[slice], 0, 'la tranche est rendue');
  assert.equal(plan.slices.atlas.occupancy().used, 0, 'les cellules d’atlas sont rendues');
  assert.equal(freeSlices(plan), MAX_SHADOW_SLICES, 'les 64 tranches sont de nouveau libres');
});

test('un retrait au milieu de la liste laisse à la lampe déplacée sa propre tranche et son rectangle d’atlas', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(64);
  for (const id of ['a', 'b', 'c']) store.add(pointLight(id));
  plan.plan(store, VIEW, 0, 0);

  const sliceA = store.sliceOf(store.slotOf('a'));
  const sliceB = store.sliceOf(store.slotOf('b'));
  const sliceC = store.sliceOf(store.slotOf('c'));
  const rectCBefore = Array.from(
    plan.slices.rects.subarray(sliceC * RECTS_PER_SLICE, (sliceC + 1) * RECTS_PER_SLICE),
  );

  // Le magasin fait un retrait par échange : 'c', dernière de la liste, prend le slot de 'a'.
  store.remove('a');
  assert.equal(store.slotOf('c'), 0, 'le magasin a déplacé c au slot libéré par a');
  assert.equal(store.sliceOf(0), sliceC, 'c a gardé sa propre tranche pendant le déplacement');

  plan.plan(store, VIEW, 1, 16);

  assert.equal(plan.slices.taken[sliceA], 0, 'la tranche de la lampe retirée est rendue');
  assert.equal(plan.slices.taken[sliceC], 1, 'c garde toujours sa tranche, la même qu’avant');
  assert.equal(plan.slices.taken[sliceB], 1, 'b, jamais déplacée, n’est pas affectée');
  const rectCAfter = Array.from(
    plan.slices.rects.subarray(sliceC * RECTS_PER_SLICE, (sliceC + 1) * RECTS_PER_SLICE),
  );
  assert.deepEqual(rectCAfter, rectCBefore, 'le rectangle d’atlas de c n’a pas bougé');
});

test('retirer toutes les lampes ramène l’occupation d’atlas à zéro et les 64 tranches à libres', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(64);
  const ids = Array.from({ length: 5 }, (_, i) => `l${i}`);
  for (const id of ids) store.add(pointLight(id));
  plan.plan(store, VIEW, 0, 0);
  assert.ok(plan.slices.atlas.occupancy().used > 0, 'l’atlas porte bien les cinq lampes');

  for (const id of ids) store.remove(id);
  plan.plan(store, VIEW, 1, 16);

  assert.equal(plan.slices.atlas.occupancy().used, 0, 'plus une seule cellule occupée');
  assert.equal(freeSlices(plan), MAX_SHADOW_SLICES, 'les 64 tranches sont libres');
});

test('retirer une lampe alors que des régions sont en file ne laisse ni page en attente ni cellule occupée pour elle', () => {
  const store = createSceneLightStore();
  // Capacité de six régions : exactement une lampe ponctuelle (six faces). La seconde lampe ne
  // passe pas cette image-ci et ses six faces restent en attente, comme un budget trop juste.
  const plan = createShadowPlan(6);
  store.add(pointLight('l0'));
  store.add(pointLight('l1'));
  plan.plan(store, VIEW, 0, 0);

  const slice1 = store.sliceOf(store.slotOf('l1'));
  assert.ok(slice1 >= 0, 'l1 a tout de même obtenu une tranche, juste pas ses pages dessinées');
  let pending = false;
  for (let face = 0; face < 6; face++) if (plan.slices.dirty.isDirty(slice1, face)) pending = true;
  assert.ok(pending, 'l1 a des pages en attente, faute de place dans les régions de cette image');

  store.remove('l1');
  plan.plan(store, VIEW, 1, 16);

  for (let face = 0; face < 6; face++)
    assert.equal(
      plan.slices.dirty.isDirty(slice1, face),
      false,
      'aucune page en attente sur une tranche rendue',
    );
  assert.equal(plan.slices.taken[slice1], 0, 'et la tranche elle-même est rendue');
});

test('trois cycles retrait/remise de 21 lampes à ombre donnent une occupation identique au premier cycle et zéro refus', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(256);
  const ids = Array.from({ length: 21 }, (_, i) => `l${i}`);
  for (const id of ids) store.add(pointLight(id));
  plan.plan(store, VIEW, 0, 0);

  const baselineUsed = plan.slices.atlas.occupancy().used;
  const baselineFree = freeSlices(plan);
  // Chiffres du commit e99326a2 pour cette même scène (21 ponctuelles, mêmes réglages) : 43 tranches
  // libres sur 64, 504 cellules d'atlas prises.
  assert.equal(baselineFree, MAX_SHADOW_SLICES - 21);
  assert.equal(baselineUsed, 504);
  assert.equal(plan.counts.denied, 0, 'les 21 lampes tiennent toutes dans les 64 tranches');

  let frame = 1;
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const id of ids) store.remove(id);
    plan.plan(store, VIEW, frame++, frame * 16);
    assert.equal(plan.slices.atlas.occupancy().used, 0, `cycle ${cycle}: atlas vidé au retrait`);
    assert.equal(
      freeSlices(plan),
      MAX_SHADOW_SLICES,
      `cycle ${cycle}: les 64 tranches sont libres`,
    );

    for (const id of ids) store.add(pointLight(id));
    plan.plan(store, VIEW, frame++, frame * 16);
    assert.equal(
      plan.slices.atlas.occupancy().used,
      baselineUsed,
      `cycle ${cycle}: occupation d’atlas identique au premier cycle`,
    );
    assert.equal(
      freeSlices(plan),
      baselineFree,
      `cycle ${cycle}: tranches libres identiques au premier cycle`,
    );
    // Le défaut d'origine : sans la libération, les tranches retirées restaient prises et, au bout
    // de trois cycles, les 64 étaient saturées — 21 refus au lieu de 21 tranches rendues.
    assert.equal(
      plan.counts.denied,
      0,
      `cycle ${cycle}: zéro refus, contrairement au défaut d’origine`,
    );
  }
});
