import test from 'node:test';
import assert from 'node:assert/strict';
import { textureLevelUrl } from './textureLevelUrl.ts';

const SHA = 'ab'.repeat(32);
const TEMPLATE = '../../textures/{sha}/{kind}-{level}.png';

test('un niveau cuit s’adresse par empreinte, atlas et rang, depuis le gabarit du manifeste', () => {
  assert.equal(textureLevelUrl(TEMPLATE, SHA, 0, 3), `../../textures/${SHA}/srgb-3.png`);
  assert.equal(textureLevelUrl(TEMPLATE, SHA, 1, 0), `../../textures/${SHA}/linear-0.png`);
});

test('un atlas inconnu, une empreinte ou un rang invalides, un gabarit sans champ sont refusés', () => {
  assert.throws(() => textureLevelUrl(TEMPLATE, SHA, 2, 0), /unknown atlas/);
  assert.throws(() => textureLevelUrl(TEMPLATE, 'abc', 0, 0), /invalid address/);
  assert.throws(() => textureLevelUrl(TEMPLATE, SHA, 0, -1), /invalid address/);
  assert.throws(() => textureLevelUrl(TEMPLATE, SHA, 0, 1.5), /invalid address/);
  assert.throws(() => textureLevelUrl('../../textures/{sha}.png', SHA, 0, 0), /lacks a field/);
});
