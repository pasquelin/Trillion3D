import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildPortal } from './docs/build-portal.ts';
import { loadReactComponents } from './docs/render-react.ts';
import { entriesIn } from '../site/app/portal/data.ts';
import type { Entry as EntryComponent } from '../site/app/Entry.tsx';
import type { Chapter as ChapterComponent } from '../site/app/course/Chapter.tsx';
import { readyExampleIds } from '../site/app/examples/list.ts';

const { Entry } = (await loadReactComponents('site/app/Entry.tsx')) as {
  Entry: typeof EntryComponent;
};

test('an API entry reads in one order: signature, parameters, returns, example, members, details', () => {
  const entries = entriesIn('en');
  const fn = entries.find((entry) => entry.parameters && entry.returns && entry.example);
  const type = entries.find((entry) => entry.members?.length);
  assert.ok(fn && type);
  const order = (html: string, titles: string[]) =>
    titles.map((title) => html.indexOf(`>${title}<`)).filter((at) => at >= 0);
  const page = renderToStaticMarkup(createElement(Entry, { entry: fn, locale: 'en' }));
  const found = order(page, ['Signature', 'Parameters', 'Returns', 'Example']);
  assert.equal(found.length, 4, fn.id);
  assert.deepEqual(
    [...found].sort((a, b) => a - b),
    found,
  );
  for (const row of fn.parameters ?? []) assert.ok(page.includes(`>${row.name}</td>`), row.name);
  const members = renderToStaticMarkup(createElement(Entry, { entry: type, locale: 'fr' }));
  assert.match(members, />Membres</);
  assert.doesNotMatch(page, /github\.com\/[^"]+\/blob\//, 'no source path on the page');
});

test('a course chapter reads as steps, highlighted code, its example live, then the next one', async () => {
  const { Chapter } = (await loadReactComponents('site/app/course/Chapter.tsx')) as {
    Chapter: typeof ChapterComponent;
  };
  for (const entry of entriesIn('fr').filter(({ chapter }) => chapter)) {
    const { chapter } = entry;
    assert.ok(chapter && readyExampleIds.includes(chapter.example), entry.id);
    const page = renderToStaticMarkup(createElement(Chapter, { entry, locale: 'fr' }));
    assert.equal((page.match(/<li>/g) ?? []).length, chapter.steps.length, entry.id);
    assert.equal((page.match(/data-code-block/g) ?? []).length, chapter.code.length, entry.id);
    assert.ok(page.includes(`<iframe src="examples/${chapter.example}.html?lang=fr"`), entry.id);
    assert.ok(page.includes(`href="${chapter.next.href}"`), entry.id);
    assert.doesNotMatch(page, /<pre class="rounded-box/);
  }
});

test('the course pager has no previous on the first chapter and leads to the examples from the last', async () => {
  const { Chapter } = (await loadReactComponents('site/app/course/Chapter.tsx')) as {
    Chapter: typeof ChapterComponent;
  };
  const chapters = entriesIn('en').filter(({ chapter }) => chapter);
  const [first, second] = chapters;
  const [before, last] = chapters.slice(-2);
  const page = (entry: (typeof chapters)[number]) =>
    renderToStaticMarkup(createElement(Chapter, { entry, locale: 'en' }));
  const opening = page(first);
  assert.doesNotMatch(opening, /rel="prev"/);
  assert.match(opening, new RegExp(`href="#/en/learn/${second.id}" rel="next"`));
  const closing = page(last);
  assert.match(closing, new RegExp(`href="#/en/learn/${before.id}" rel="prev"`));
  assert.match(closing, /href="#\/en\/examples" rel="next"/);
});

test('the generated reference loads apart from the portal, with the API area', async () => {
  const out = await mkdtemp(join(tmpdir(), 'trillion3d-portal-'));
  try {
    await buildPortal(resolve(import.meta.dirname, '..'), out);
    const reference = entriesIn('en')
      .filter(({ section }) => section !== 'guides')
      .at(-1)!;
    const holds = async (file: string) =>
      (await readFile(join(out, file), 'utf8')).includes(reference.summary ?? reference.id);
    assert.equal(await holds('portal.js'), false, 'the main bundle carries no reference entry');
    const chunks = (await readdir(out)).filter((file) => file !== 'portal.js');
    const holding = [];
    for (const chunk of chunks) if (await holds(chunk)) holding.push(chunk);
    assert.equal(holding.length, 1, 'one chunk carries the reference');
    assert.ok((await stat(join(out, 'portal.js'))).size < 400_000);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
