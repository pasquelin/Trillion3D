// Lot F, F10 : `surfaceColorAttachments` (webgpuPagesEncodeVisSetup.ts) garde les quatre descripteurs
// de pièce jointe tant que `surfaces.views()` rend le même tableau, au lieu d'en allouer cinq objets
// à chaque image. `views()` reste appelé à chaque image ; seule la reconstruction est conditionnelle.
// L'oracle est la reconstruction inconditionnelle d'avant le lot F, recopiée telle quelle dans
// `oracles/cadre-vue.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { surfaceColorAttachments } from './webgpuPagesEncodeVisSetup.ts';
import { referenceAttachments } from './bench/oracles/cadre-vue.mjs';
import type { SurfaceBuffer } from './surfaceBuffer.ts';

const surfacesWith = (views: GPUTextureView[]) =>
  ({ views: () => views }) as unknown as SurfaceBuffer;

function memeContenu(obtenu: readonly unknown[], attendu: readonly unknown[]) {
  assert.deepEqual(obtenu, attendu);
}

test('aucune vue : les deux côtés rendent un tableau de pièces jointes vide', () => {
  const surfaces = surfacesWith([]);
  memeContenu(surfaceColorAttachments(surfaces), referenceAttachments(surfaces));
});

test('un jeu de vues stable rend des descripteurs identiques à la reconstruction inconditionnelle', () => {
  const views = [{ label: 'a' }, { label: 'b' }, { label: 'c' }] as unknown as GPUTextureView[];
  const surfaces = surfacesWith(views);
  memeContenu(surfaceColorAttachments(surfaces), referenceAttachments(surfaces));
});

test('deux images sur le même jeu de vues rendent le même tableau de pièces jointes (mémoïsation)', () => {
  const views = [{ label: 'a' }] as unknown as GPUTextureView[];
  const surfaces = surfacesWith(views);
  const premiere = surfaceColorAttachments(surfaces);
  const seconde = surfaceColorAttachments(surfaces);
  assert.equal(seconde, premiere, 'le même tableau de pièces jointes est réutilisé');
  memeContenu(seconde, referenceAttachments(surfaces));
});

test('un redimensionnement (nouveau tableau de vues) reconstruit les pièces jointes, sans dériver de la référence', () => {
  const surfaces1 = surfacesWith([{ label: 'a' }] as unknown as GPUTextureView[]);
  const premiere = surfaceColorAttachments(surfaces1);
  const views2 = [{ label: 'a2' }, { label: 'b2' }] as unknown as GPUTextureView[];
  const surfaces2 = surfacesWith(views2);
  const seconde = surfaceColorAttachments(surfaces2);
  assert.notEqual(seconde, premiere, 'un nouveau jeu de vues reconstruit le tableau');
  memeContenu(seconde, referenceAttachments(surfaces2));
});

test('un moteur qui revient à un jeu de vues déjà vu ailleurs reconstruit quand même (identité de tableau, pas de contenu)', () => {
  // `attachmentsFor !== views` compare des identités de tableau : deux tableaux de contenu identique
  // mais d'identité différente (deux `SurfaceBuffer` distincts) ne doivent jamais être confondus.
  const viewsA = [{ label: 'x' }] as unknown as GPUTextureView[];
  const viewsB = [{ label: 'x' }] as unknown as GPUTextureView[];
  const surfacesA = surfacesWith(viewsA);
  const surfacesB = surfacesWith(viewsB);
  const attA = surfaceColorAttachments(surfacesA);
  const attB = surfaceColorAttachments(surfacesB);
  assert.notEqual(attB, attA, 'deux identités de vues distinctes ne partagent pas leur cache');
  memeContenu(attA, referenceAttachments(surfacesA));
  memeContenu(attB, referenceAttachments(surfacesB));
});
