// Une coupe GPU incomplète doit pouvoir se reprendre toute seule. L'image en attente ne dessine
// rien, mais elle réclame les pages manquantes, publie la résidence et envoie la sélection : sans
// cet envoi, le même relevé incomplet reviendrait à chaque image et la coupe resterait bloquée
// dessus, caméra immobile, même une fois les octets arrivés.
//
// Le relevé complet de la reprise n'est pas fourni par le test : il est produit par la sélection
// simulée, à partir des drapeaux de résidence que l'image en attente lui a publiés. Le dispositif
// lui-même est dans `webgpuCutRepriseFixture.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { banc } from './webgpuCutRepriseFixture.ts';

test('une image en attente réclame, synchronise et envoie : la reprise a de quoi se produire', () => {
  const b = banc();
  for (let i = 0; i < 3; i++) assert.equal(b.image(), true, `image ${i}`);
  assert.equal(b.comptes.attentes, 3, 'les trois images ont attendu une couverture complète');
  assert.equal(b.rt.gpu.cutIncomplete, true, 'et la coupe est restée incomplète, page absente');
  // Aucune image d'attente ne se contente de relire : chacune a fait avancer le flux.
  assert.equal(b.comptes.queue, 3, 'les pages voulues sont réclamées à chaque attente');
  assert.equal(b.comptes.sync, 3, 'la résidence est synchronisée à chaque attente');
  assert.equal(b.comptes.envois, 3, 'la sélection est envoyée à chaque attente');
  // La liste voulue est publiée : c'est elle qui fait venir la page manquante.
  assert.deepEqual(
    b.desired.map((p) => p.url),
    ['p0'],
  );
  assert.deepEqual(b.shown, [], 'rien n’est dessiné depuis une couverture incomplète');
});

test('la page arrivée, la coupe redevient complète sans que la caméra bouge', () => {
  const b = banc();
  b.image();
  assert.equal(b.rt.gpu.cutIncomplete, true);
  // Les octets arrivent. La caméra n'a pas bougé et le budget n'a pas changé.
  b.arrive();
  const envoisAvant = b.comptes.envois;
  assert.equal(b.image(), true, 'l’image reste en attente : le relevé complet n’est pas encore là');
  assert.ok(b.comptes.envois > envoisAvant, 'mais elle a publié la résidence et envoyé');
  // L'image suivante commence par adopter : elle trouve le relevé complet que l'attente a fait
  // produire. Le test n'en a fourni aucun.
  b.rt.services.adoptGpuCut();
  assert.equal(b.rt.gpu.cutIncomplete, false, 'la couverture est complète');
  assert.deepEqual(
    b.shown.map((p) => p.url),
    ['p0'],
    'et la page est dessinée',
  );
});

test('une attente qui déborde des identifiants de visibilité replie sur la coupe processeur', () => {
  const b = banc('debordement');
  for (let i = 0; i < 3; i++) b.image();
  assert.ok(b.codes.includes('gpu-selection-capacity'), 'la capacité est annoncée');
  assert.ok(b.codes.includes('gpu-selection-fallback'), 'le repli processeur est annoncé');
  assert.equal(b.rt.run.gpuSelection, undefined, 'aucune sélection GPU n’est conservée');
  assert.equal(b.comptes.envois, 0, 'aucun envoi depuis un relevé que la capacité interdit');
  assert.equal(b.comptes.attentes, 0, 'et l’image n’attend pas un relevé qui ne viendra jamais');
});

test('une attente dont l’envoi échoue replie une fois, elle ne réessaie pas trois fois', () => {
  const b = banc('envoi');
  for (let i = 0; i < 3; i++) b.image();
  assert.equal(
    b.codes.filter((code) => code === 'gpu-selection-dispatch-failed').length,
    1,
    'un seul échec annoncé : le repli a eu lieu dès le premier',
  );
  assert.ok(b.codes.includes('gpu-selection-fallback'), 'le repli processeur est annoncé');
  assert.equal(b.rt.run.gpuSelection, undefined, 'aucune sélection GPU n’est conservée');
  assert.equal(b.comptes.envois, 1, 'un seul envoi tenté');
  assert.equal(b.comptes.attentes, 0, 'aucune image n’a attendu');
  assert.deepEqual(b.shown, [], 'rien n’est dessiné depuis une couverture incomplète');
});
