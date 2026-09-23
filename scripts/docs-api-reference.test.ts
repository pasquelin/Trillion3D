// The API reference covers the whole published interface of `web-geometry`: every export of its
// three conditions (common, browser, Node), every member of every family and of the world, each
// with a summary of its own and every row explained; its translations are `scripts/i18n-keys.ts`'s.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import generated from '../site/content/reference/api.json' with { type: 'json' };
import * as browser from '../packages/sdk/browser.ts';
import { entriesIn } from '../site/app/portal/data.ts';
import { expandEntryLinks } from '../site/app/portal/entryLinks.ts';
import { LEARN_SECTIONS } from '../site/app/portal/routes.ts';
import { NOTES } from '../site/content/entries/reference.ts';
import { entrySummary, FAMILIES, SECTIONS } from '../site/content/model.ts';
import type { PortalEntry } from '../site/content/model.ts';
import { repositoryFiles } from './repository-files.ts';
import { apiProgram, entryModules, PUBLIC_ENTRIES } from './sdk-api-model.ts';

const api = entriesIn('en').filter((entry) => !LEARN_SECTIONS.includes(entry.section));
const ids = new Set(api.map((entry) => entry.id));

test('every export of the three public conditions has an entry of its own', () => {
  const program = apiProgram(PUBLIC_ENTRIES);
  const checker = program.getTypeChecker();
  for (const [entry, module] of entryModules(program, PUBLIC_ENTRIES))
    for (const symbol of checker.getExportsOfModule(module))
      assert.ok(ids.has(symbol.name), `${entry}: ${symbol.name} has no entry`);
});

test('every member of every family has an entry of its own', () => {
  const families = browser as unknown as Record<string, Record<string, unknown>>;
  for (const family of FAMILIES) {
    assert.ok(ids.has(family), `the ${family} family has no entry`);
    for (const member of Object.keys(families[family]))
      assert.ok(ids.has(`${family}.${member}`), `${family}.${member} has no entry`);
  }
  assert.ok(ids.has('createWorld'));
  assert.ok(
    api.some((entry) => entry.id.startsWith('world.')),
    'the world lists no member',
  );
});

test('every entry says what it is in a summary of its own, and every member row too', () => {
  const seen = new Map<string, string>();
  for (const entry of api) {
    const summary = entrySummary(entry);
    assert.ok(summary, `${entry.id} has no summary`);
    const twin = seen.get(summary);
    assert.ok(!twin, `${entry.id} and ${twin} share the summary "${summary}"`);
    seen.set(summary, entry.id);
    for (const row of entry.members ?? [])
      assert.ok(row.desc, `${entry.id}: the member ${row.name} has no description`);
  }
});

test('no two items of the index lead to the same page', () => {
  const links = expandEntryLinks(api).map(({ id }) => id);
  assert.equal(new Set(links).size, links.length);
});

test('the reference opens on the world and its families, each entry in its module section', () => {
  const families = SECTIONS.slice(SECTIONS.indexOf('world'), SECTIONS.indexOf('math-utilities'));
  assert.equal(families[0], 'world');
  for (const id of families.slice(1))
    assert.ok(id === 'constants' || FAMILIES.includes(id), `${id} is not a family`);
  const sections = new Set(SECTIONS);
  for (const entry of api)
    assert.ok(sections.has(entry.section), `${entry.id}: unknown section ${entry.section}`);
});

test('every code an EngineError is thrown with is explained on its page', () => {
  const thrown =
    /(?:new EngineError|sceneNodeFail)\(\s*(?:[^'(),]*\?\s*)?'([A-Z][A-Z0-9_]+)'(?:\s*:\s*'([A-Z][A-Z0-9_]+)')?/g;
  const codes = new Set<string>();
  for (const file of repositoryFiles() ?? [])
    if (/^packages\/.*\.m?ts$/.test(file) && !file.includes('.test.'))
      for (const match of readFileSync(file, 'utf8').matchAll(thrown))
        for (const code of match.slice(1)) if (code) codes.add(code);
  assert.ok(codes.size > 0, 'no thrown code found');
  const page = api.find(({ id }) => id === 'EngineError');
  const explained = new Set(page?.values?.filter(({ desc }) => desc).map(({ name }) => name));
  for (const code of codes) assert.ok(explained.has(code), `EngineError: ${code} is not explained`);
});

test('a written note completes a generated entry, never stands alone', () => {
  const generatedIds = new Set((generated as PortalEntry[]).map(({ id }) => id));
  for (const id of NOTES.keys()) assert.ok(generatedIds.has(id), `note ${id} completes nothing`);
});
