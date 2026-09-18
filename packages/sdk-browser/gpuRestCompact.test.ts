import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuRestCompact } from './gpuRestCompact.ts';
import { REST_COMPACT_SHADER } from './gpuRestCompactWgsl.ts';
import { VIS_SHADER } from './visibilityBuffer.ts';
import { BASE_SLOTS } from './gpuDraw.ts';
import { HIZ_REJECTED_WGSL, VERDICT_REJECTED } from './gpuPartitionContract.ts';

// Comportement 1 : la troncature retient EXACTEMENT ce que l'étage de sommets dessinait — les deux
// textes portent le même `hizRejected`, et la troncature en garde la négation. Un prédicat recopié
// à la main avait tronqué toute la moitié testée quand le verdict est passé à trois valeurs.
test('la troncature de la moitié testée applique le prédicat de l’étage de sommets', () => {
  assert.ok(VIS_SHADER.includes(HIZ_REJECTED_WGSL), 'l’étage de sommets lie le prédicat partagé');
  assert.ok(REST_COMPACT_SHADER.includes(HIZ_REJECTED_WGSL), 'la troncature lie le même texte');
  assert.match(VIS_SHADER, /if\(hizRejected\(page\.hizSlot\)\)/);
  assert.match(REST_COMPACT_SHADER, /return !hizRejected\(pages\[ligne\]\.hizSlot\);/);
  assert.match(HIZ_REJECTED_WGSL, new RegExp(`==${VERDICT_REJECTED}u;`));
});

// Comportement 2 : rien n'est déplacé. Le rang de la dernière survivante devient le compte, si bien
// que l'ordre des instances retenues est celui que la compaction de dessin leur a donné.
test('la troncature ne déplace aucune instance et ne touche que le compte', () => {
  assert.match(REST_COMPACT_SHADER, /atomicMax\(&dernieres\[id\.y\],id\.x\+1u\)/);
  assert.match(REST_COMPACT_SHADER, /indirect\[restSlotAt\(id\.x\)\*4u\+1u\]=atomicLoad/);
  assert.match(REST_COMPACT_SHADER, /@binding\(0\) var<storage, read> instances/);
  // Le mot 0 de la commande, le nombre de sommets, n'est jamais réécrit.
  assert.doesNotMatch(REST_COMPACT_SHADER, /indirect\[[^\]]*\*4u\]=/);
});

// Comportement 3 : le rang du slot testé numéro n suit la convention de `slotOf` — trois modes de
// face par couche, la moitié testée après les occulteurs.
test('les slots visités sont ceux de la moitié testée', () => {
  const half = BASE_SLOTS / 2;
  assert.match(
    REST_COMPACT_SHADER,
    new RegExp(`return \\(n/${half}u\\)\\*${BASE_SLOTS}u\\+${half}u\\+n%${half}u;`),
  );
});

// Comportement 4 : sans calcul, il n'y a pas de troncature et l'image garde le chemin d'avant.
test('un appareil sans calcul ne monte pas la troncature', async () => {
  const buffer = {} as GPUBuffer;
  const device = { createBuffer: () => buffer } as unknown as GPUDevice;
  const made = await createGpuRestCompact(device, {
    instances: buffer,
    indirect: buffer,
    slotOffsets: buffer,
    flags: buffer,
  });
  assert.equal(made, undefined);
});
