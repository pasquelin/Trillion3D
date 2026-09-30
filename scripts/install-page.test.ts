import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { DEFAULT_LANGUAGE, LANGUAGES } from '../site/content/i18n/dictionary.ts';
import { codeBlocks, installPageHtml, repositoryLinks, walkthrough } from './install-page.ts';

const root = new URL('../', import.meta.url);
const english = await installPageHtml(DEFAULT_LANGUAGE);

test('the Install page installs, compiles, draws and names its two headers', () => {
  const { commands, page, headers } = walkthrough(codeBlocks(english));
  assert.deepEqual(commands, [
    'npm install trillion3d',
    'npx trillion3d-compile public/model.glb public/model slice 150000 /',
  ]);
  assert.match(
    page,
    /"trillion3d": "https:\/\/cdn\.jsdelivr\.net\/npm\/trillion3d\/dist\/trillion3d\.module\.js"/,
  );
  assert.match(page, /scene\.load\('\/model\/native\/slice\/manifest\.json'\)/);
  assert.deepEqual(headers, {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
  });
});

test('every language gives English its commands and its links', async () => {
  for (const { code } of LANGUAGES) {
    const html = await installPageHtml(code);
    assert.deepEqual(codeBlocks(html), codeBlocks(english), `${code}: its code blocks`);
    assert.deepEqual(repositoryLinks(html), repositoryLinks(english), `${code}: its links`);
  }
});

test('the page links the message codes, and every code page is reachable from their list', () => {
  const links = repositoryLinks(english);
  for (const path of links) assert.ok(existsSync(new URL(path, root)), `${path} exists`);
  assert.ok(links.includes('docs/COMPILER_ERRORS.md'));
  assert.ok(links.includes('LICENSE'));
  const platform = readFileSync(new URL('docs/messages/T3D-E079.md', root), 'utf8');
  assert.match(platform, /COMPILER_PLATFORM_UNSUPPORTED/);
  // Page -> docs/COMPILER_ERRORS.md -> docs/messages/<code>.md: the list links every code page,
  // each link resolves to a file, and each page is named after the one T3D code it explains.
  const list = readFileSync(new URL('docs/COMPILER_ERRORS.md', root), 'utf8');
  const listed = [...list.matchAll(/\]\(messages\/([^)#]+)\)/g)].map(([, page]) => page);
  const pages = readdirSync(new URL('docs/messages/', root));
  assert.ok(pages.some((page) => page.startsWith('T3D-W')));
  assert.deepEqual([...new Set(listed)].sort(), [...pages].sort(), 'every code page is listed');
  for (const page of pages) {
    const code = /^(T3D-[EWI]\d{3})\.md$/.exec(page)?.[1];
    assert.ok(code, `${page} is named after a T3D code`);
    const text = readFileSync(new URL(`docs/messages/${page}`, root), 'utf8');
    assert.ok(text.startsWith(`# ${code} `), `${page} explains ${code}`);
    assert.match(text, /\]\(\.\.\/COMPILER_ERRORS\.md#/, `${page} links back to the list`);
  }
});

test('a page without a step is refused by name', () => {
  assert.throws(() => walkthrough(['npm install trillion3d']), /compiles nothing/);
  const blocks = codeBlocks(english).filter((block) => !block.startsWith('Cross-Origin-'));
  assert.throws(() => walkthrough(blocks), /no server header/);
});
