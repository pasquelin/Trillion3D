import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentHashes,
  hashOf,
  parse,
  serialise,
  staleTranslations,
} from './check-translations.ts';

const recorded = {
  'portal:nav.primary': { en: hashOf('Main navigation'), fr: hashOf('Navigation principale') },
  'examples:water': { en: hashOf({ banner: 'Water' }), fr: hashOf({ banner: 'Eau' }) },
};

test('English changed under a key whose translation did not: that language is behind', () => {
  const current = {
    ...recorded,
    'portal:nav.primary': {
      en: hashOf('Primary navigation'),
      fr: recorded['portal:nav.primary'].fr,
    },
  };
  assert.deepEqual(staleTranslations(recorded, current), ['fr portal:nav.primary']);
});

test('a translation changed with its English, or alone, or a new entry, is not behind', () => {
  const current = {
    'portal:nav.primary': { en: hashOf('Primary navigation'), fr: hashOf('Navigation') },
    'examples:water': { en: recorded['examples:water'].en, fr: hashOf({ banner: "L'eau" }) },
    'examples:fire': { en: hashOf('Fire'), fr: hashOf('Feu') },
  };
  assert.deepEqual(staleTranslations(recorded, current), []);
});

test('the record reads back the hashes it was written from', () => {
  assert.deepEqual(parse(serialise(recorded)), recorded);
  assert.deepEqual(parse(serialise({})), {});
  assert.equal(hashOf(undefined), '-');
});

test('every English entry is hashed in every language', () => {
  const current = currentHashes();
  assert.ok(Object.keys(current).some((entry) => entry.startsWith('reference:')));
  assert.ok(Object.keys(current).some((entry) => entry.startsWith('examples:')));
  for (const [entry, byLanguage] of Object.entries(current)) {
    assert.ok(Object.keys(byLanguage).includes('fr'), entry);
    assert.notEqual(byLanguage.en, '-', entry);
  }
});
