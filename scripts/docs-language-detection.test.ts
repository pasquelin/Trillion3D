// The portal's language: the route names it, and a route that names none takes the detected one,
// in order the reader's last choice, the browser, then English. The detector reads the browser's
// globals, so they are stood in before the portal's i18n module loads.
import assert from 'node:assert/strict';
import test from 'node:test';

const storage = new Map<string, string>();
Object.assign(globalThis, {
  window: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  },
});
const browser = { languages: ['en-US'] };
Object.defineProperty(globalThis, 'navigator', { value: browser, configurable: true });
const { detectedLanguage, i18n, loadLanguage } = await import('../site/app/i18n.ts');
const { parseRoute } = await import('../site/app/portal/routes.ts');

/** The language a visit to `hash` settles on, with this remembered choice and browser. */
const languageOf = async (hash: string, remembered: string | null, languages: string[]) => {
  storage.clear();
  if (remembered) storage.set('web-geometry.language', remembered);
  browser.languages = languages;
  await i18n.changeLanguage();
  return parseRoute(hash, detectedLanguage()).locale;
};

test('the route names the language first, then the last choice, then the browser, then English', async () => {
  assert.equal(await languageOf('#/fr/api/createWorld', 'en', ['en-US']), 'fr');
  assert.equal(await languageOf('#/xx/learn', 'fr', ['en-US']), 'fr');
  assert.equal(await languageOf('', null, ['fr-CA', 'en']), 'fr');
  assert.equal(await languageOf('', null, ['xx-XX']), 'en');
});

test('a language the route names becomes the remembered choice, its words read first', async () => {
  storage.clear();
  assert.equal(i18n.getFixedT('fr')('nav.learn'), 'Learn');
  await loadLanguage('fr');
  await i18n.changeLanguage('fr');
  assert.notEqual(i18n.getFixedT('fr')('nav.learn'), 'Learn');
  assert.equal(storage.get('web-geometry.language'), 'fr');
});

test('a regional dictionary gives its own words, not its language’s or English', () => {
  // As if `site/i18n/pt-BR.json` were added: a supported code, and its words.
  (i18n.options.supportedLngs as string[]).push('pt-BR');
  i18n.addResourceBundle('pt-BR', 'translation', { nav: { learn: 'Aprender' } });
  assert.equal(i18n.getFixedT('pt-BR')('nav.learn'), 'Aprender');
});
