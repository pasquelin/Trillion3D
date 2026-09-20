// Lot F, F10: `surfaceColorAttachments` (webgpuPagesAttachments.ts) keeps the four attachment
// descriptors while `surfaces.views()` returns the same array, instead of allocating five objects
// every image. `views()` is still called every image; only reconstruction is conditional.
// The oracle is the unconditional reconstruction from before lot F, copied as-is into
// `oracles/cadre-vue.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { surfaceColorAttachments } from './webgpuPagesAttachments.ts';
import { referenceAttachments } from './bench/oracles/cadre-vue.mjs';
import type { SurfaceBuffer } from './surfaceBuffer.ts';

const surfacesWith = (views: GPUTextureView[]) =>
  ({ views: () => views }) as unknown as SurfaceBuffer;

function memeContenu(obtenu: readonly unknown[], attendu: readonly unknown[]) {
  assert.deepEqual(obtenu, attendu);
}

test('no view: both sides return an empty attachment array', () => {
  const surfaces = surfacesWith([]);
  memeContenu(surfaceColorAttachments(surfaces), referenceAttachments(surfaces));
});

test('a stable view set returns descriptors identical to the unconditional reconstruction', () => {
  const views = [{ label: 'a' }, { label: 'b' }, { label: 'c' }] as unknown as GPUTextureView[];
  const surfaces = surfacesWith(views);
  memeContenu(surfaceColorAttachments(surfaces), referenceAttachments(surfaces));
});

test('two images on the same view set return the same attachment array (memoisation)', () => {
  const views = [{ label: 'a' }] as unknown as GPUTextureView[];
  const surfaces = surfacesWith(views);
  const premiere = surfaceColorAttachments(surfaces);
  const seconde = surfaceColorAttachments(surfaces);
  assert.equal(seconde, premiere, 'the same attachment array is reused');
  memeContenu(seconde, referenceAttachments(surfaces));
});

test('a resize (new view array) rebuilds the attachments, without deriving from the reference', () => {
  const surfaces1 = surfacesWith([{ label: 'a' }] as unknown as GPUTextureView[]);
  const premiere = surfaceColorAttachments(surfaces1);
  const views2 = [{ label: 'a2' }, { label: 'b2' }] as unknown as GPUTextureView[];
  const surfaces2 = surfacesWith(views2);
  const seconde = surfaceColorAttachments(surfaces2);
  assert.notEqual(seconde, premiere, 'a new view set rebuilds the array');
  memeContenu(seconde, referenceAttachments(surfaces2));
});

test('an engine that returns to a view set already seen elsewhere still rebuilds (array identity, not content)', () => {
  // The cache is keyed by array identity: two arrays of identical content but
  // different identity (two distinct `SurfaceBuffer`s) must never be confused.
  const viewsA = [{ label: 'x' }] as unknown as GPUTextureView[];
  const viewsB = [{ label: 'x' }] as unknown as GPUTextureView[];
  const surfacesA = surfacesWith(viewsA);
  const surfacesB = surfacesWith(viewsB);
  const attA = surfaceColorAttachments(surfacesA);
  const attB = surfaceColorAttachments(surfacesB);
  assert.notEqual(attB, attA, 'two distinct view identities do not share their cache');
  memeContenu(attA, referenceAttachments(surfacesA));
  memeContenu(attB, referenceAttachments(surfacesB));
});

test('two surface buffers alive at once each keep their attachments (opaque resolve and water)', () => {
  const opaque = surfacesWith([{ label: 'opaque' }] as unknown as GPUTextureView[]);
  const water = surfacesWith([{ label: 'water' }] as unknown as GPUTextureView[]);
  const first = [surfaceColorAttachments(opaque), surfaceColorAttachments(water)];
  const second = [surfaceColorAttachments(opaque), surfaceColorAttachments(water)];
  assert.equal(second[0], first[0], 'the opaque set survives a water image between two of its own');
  assert.equal(second[1], first[1], 'and the water set survives an opaque one');
});
