// The portal's language, detected in order: the route, the reader's last choice, the browser,
// then English. The detector reads the browser's globals, so they are stood in before the
// portal's i18n module loads.
import assert from 'node:assert/strict';
import test from 'node:test';

const storage = new Map<string, string>();
const location = { hash: '' };
Object.assign(globalThis, {
  window: {
    location,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  },
});
const browser = { languages: ['en-US'] };
Object.defineProperty(globalThis, 'navigator', { value: browser, configurable: true });
const { i18n } = await import('../site/app/i18n.ts');

/** The language a first visit settles on, with this address, remembered choice and browser. */
const detect = async (hash: string, remembered: string | null, languages: string[]) => {
  location.hash = hash;
  storage.clear();
  if (remembered) storage.set('web-geometry.language', remembered);
  browser.languages = languages;
  await i18n.changeLanguage();
  return i18n.resolvedLanguage;
};

test('the route names the language first, then the last choice, then the browser, then English', async () => {
  assert.equal(await detect('#/fr/api/createWorld', 'en', ['en-US']), 'fr');
  assert.equal(await detect('#/xx/learn', 'fr', ['en-US']), 'fr');
  assert.equal(await detect('', null, ['fr-CA', 'en']), 'fr');
  assert.equal(await detect('', null, ['xx-XX']), 'en');
});

test('a language the route names becomes the remembered choice', async () => {
  storage.clear();
  await i18n.changeLanguage('fr');
  assert.equal(storage.get('web-geometry.language'), 'fr');
});
