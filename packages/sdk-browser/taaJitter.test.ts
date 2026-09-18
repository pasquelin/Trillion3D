import test from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY_MATRIX4 } from '../sdk-core/index.ts';
import {
  TAA_SAMPLES,
  TAA_STILL_FRAMES,
  halton,
  jitterViewProjection,
  taaJitter,
} from './taaJitter.ts';

test('la suite de Halton commence par les termes connus et reste dans [0, 1)', () => {
  assert.deepEqual(
    [1, 2, 3, 4].map((i) => halton(i, 2)),
    [0.5, 0.25, 0.75, 0.125],
  );
  assert.deepEqual(
    [1, 2, 3].map((i) => halton(i, 3)),
    [1 / 3, 2 / 3, 1 / 9],
  );
  for (let i = 1; i < 200; i++) {
    assert.ok(halton(i, 2) >= 0 && halton(i, 2) < 1);
    assert.ok(halton(i, 3) >= 0 && halton(i, 3) < 1);
  }
});

test('huit gigues distinctes, centrées dans le pixel, déterministes et cycliques', () => {
  const out = new Float64Array(2),
    vues = new Set<string>();
  let sx = 0,
    sy = 0;
  for (let sample = 0; sample < TAA_SAMPLES; sample++) {
    const [x, y] = taaJitter(sample, out);
    assert.ok(Math.abs(x) < 0.5 && Math.abs(y) < 0.5, `gigue ${sample} hors du pixel`);
    vues.add(`${x},${y}`);
    sx += x;
    sy += y;
  }
  assert.equal(vues.size, TAA_SAMPLES, 'deux images du cycle partagent une position');
  // La moyenne du cycle reste près du centre : aucun biais d'un côté du pixel.
  assert.ok(Math.abs(sx / TAA_SAMPLES) < 0.1 && Math.abs(sy / TAA_SAMPLES) < 0.1);
  // Le même rang rend la même gigue, et le cycle se referme : c'est ce qui rend deux exécutions
  // identiques et le témoin A/A possible.
  assert.deepEqual([...taaJitter(3, out)], [...taaJitter(3 + TAA_SAMPLES, new Float64Array(2))]);
  assert.equal(TAA_STILL_FRAMES, 2 * TAA_SAMPLES);
});

test('la gigue est une translation en espace de clip, nulle quand le décalage est nul', () => {
  const vp = new Float64Array(16);
  for (let i = 0; i < 16; i++) vp[i] = i + 1;
  const out = new Float64Array(16);
  jitterViewProjection(out, vp, 0, 0, 640, 480);
  assert.deepEqual([...out], [...vp], 'une gigue nulle doit rendre la matrice au bit près');
  jitterViewProjection(out, vp, 0.25, -0.5, 640, 480);
  for (let column = 0; column < 4; column++) {
    const at = column * 4,
      w = vp[at + 3];
    assert.equal(out[at], vp[at] + ((2 * 0.25) / 640) * w);
    assert.equal(out[at + 1], vp[at + 1] + ((2 * -0.5) / 480) * w);
    assert.equal(out[at + 2], vp[at + 2]);
    assert.equal(out[at + 3], w);
  }
  // Un point de clip (0, 0, z, 1) décalé d'un quart de pixel atterrit à 2·0,25/640 en NDC : la
  // moitié d'un pixel de large vaut 2/640, le quart en est la moitié.
  jitterViewProjection(out, IDENTITY_MATRIX4, 0.25, 0.25, 640, 480);
  assert.equal(out[12], (2 * 0.25) / 640);
  assert.equal(out[13], (2 * 0.25) / 480);
});
