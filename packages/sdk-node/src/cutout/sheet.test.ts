import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingOf, type Sheet } from './sheet.mts';
import { leaf as feuille } from './cutout.fixture.ts';

type SheetTexture = Sheet['textures'][string];

const leaf = feuille(3);
const glass: SheetTexture = { ...feuille(1), image: 'vitre.png', proposal: 'blend' };

// Behaviour: a texture shared by two models makes one row — the answer is keyed by the image
// bytes — and the blended primitives it holds add up.
test('a shared image makes one row, and its primitives add up', () => {
  const pending = pendingOf([
    { name: 'emerald', sheet: { version: 1, textures: { abc: { ...leaf }, def: { ...glass } } } },
    { name: 'bistro', sheet: { version: 1, textures: { abc: { ...leaf, blendPrimitives: 5 } } } },
  ]);
  assert.equal(pending.length, 2);
  assert.deepEqual(
    pending.map((one) => [one.image, one.blendPrimitives, one.models]),
    [
      ['feuillage.png', 8, ['emerald', 'bistro']],
      ['vitre.png', 1, ['emerald']],
    ],
  );
  assert.equal(pending[0].proposal, true, 'the proposal travels with the row');
});

// Behaviour: what is already decided, and what the model no longer uses, is not asked again.
test('an already-decided or unused texture is not asked again', () => {
  const textures = {
    abc: { ...leaf, cutout: true },
    def: { ...leaf, cutout: false },
    ghi: { ...leaf, used: false },
    jkl: { ...leaf },
  };
  const pending = pendingOf([{ name: 'emerald', sheet: { version: 1, textures } }]);
  assert.deepEqual(
    pending.map((one) => one.sha256),
    ['jkl'],
  );
});

// Behaviour: the answer only enters sheets that know the texture. An answer about an image a
// model does not use is not invented in its sheet.

// Behaviour: a sheet of an unknown version is refused rather than guessed, and a model with no
// sheet simply has nothing to decide.
