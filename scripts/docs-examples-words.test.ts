import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import english from '../site/examples/i18n/en.json' with { type: 'json' };
import { exampleId, fill, requestedLanguage, useWords, words } from '../site/examples/kit/words.ts';
import type { WordTree } from '../site/examples/kit/words.ts';

const FOLDER = new URL('../site/examples/', import.meta.url);
const text = (node: ts.Node | undefined) =>
  node && ts.isStringLiteralLike(node) ? node.text : undefined;
const property = (node: ts.ObjectLiteralExpression, name: string) =>
  node.properties.find(
    (entry): entry is ts.PropertyAssignment =>
      ts.isPropertyAssignment(entry) && entry.name.getText() === name,
  )?.initializer;
const strings = (node: ts.Node | undefined) =>
  node && ts.isArrayLiteralExpression(node)
    ? node.elements.flatMap((item) => text(item) ?? [])
    : [];

/** The words an example asks for by a written key: `<group>.<key>`, and the English text a
 *  control declares for a note. Keys built at run time (`Object.keys(…)`, `say(name)`) are not. */
function asked(html: string): Map<string, string | undefined> {
  const keys = new Map<string, string | undefined>();
  for (const [, key] of html.matchAll(/data-words="([^"]+)"/g)) keys.set(`words.${key}`, undefined);
  const source = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      const call = node.expression.getText();
      if (call === 'readout' && text(first)) keys.set(`readouts.${text(first)}`, undefined);
      if (call === 'say' && text(first)) keys.set(`words.${text(first)}`, undefined);
      if (call === 'play') keys.set('game.title', undefined);
      if (call === 'controls' && first && ts.isObjectLiteralExpression(first))
        for (const entry of first.properties) {
          const name = entry.name?.getText() ?? '';
          const value = ts.isPropertyAssignment(entry) ? entry.initializer : undefined;
          const note = text(value);
          keys.set(`controls.${name}`, note?.startsWith('#') ? undefined : note);
          for (const choice of strings(value)) keys.set(`choices.${name}.${choice}`, undefined);
        }
    }
    if (ts.isObjectLiteralExpression(node)) {
      const action = text(property(node, 'action')),
        id = text(property(node, 'id'));
      if (action) keys.set(`game.keys.${action}`, undefined);
      if (id && property(node, 'choices')) {
        keys.set(`game.options.${id}`, undefined);
        for (const choice of strings(property(node, 'choices')))
          keys.set(`choices.${id}.${choice}`, undefined);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('example.js', source, ts.ScriptTarget.Latest, true));
  return keys;
}

const at = (tree: unknown, path: string[]) =>
  path.reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree);

test('every word an example asks for by its key is given in English, a note in its own words', () => {
  const missing: string[] = [];
  for (const file of readdirSync(FOLDER).filter((name) => name.endsWith('.html'))) {
    const id = file.slice(0, -'.html'.length);
    for (const [key, note] of asked(readFileSync(new URL(file, FOLDER), 'utf8'))) {
      const [group, name, ...rest] = key.split('.');
      const given = at(english, [id, group, ...(rest.length ? [name, rest.join('.')] : [name])]);
      if (typeof given !== 'string' || (note !== undefined && given !== note))
        missing.push(`${id}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('an example reads its id from its address, its language from ?lang= or the browser', () => {
  const address = new URL('https://site.test/examples/a-first-world.html?lang=fr-CA');
  assert.equal(exampleId(address), 'a-first-world');
  assert.equal(requestedLanguage(address, ['de-DE']), 'fr');
  assert.equal(requestedLanguage(new URL('https://site.test/x.html'), ['PT-br']), 'pt');
  assert.equal(requestedLanguage(new URL('https://site.test/x.html'), []), 'en');
});

test('a word fills its blanks, and a key the dictionary lacks reads as itself', () => {
  useWords({ demo: { words: { score: '{n} of {all}' } } } as WordTree, 'en');
  const say = words('demo');
  assert.equal(say('score', { n: 3, all: 5 }), '3 of 5');
  assert.equal(say('unknown'), 'unknown');
  assert.equal(fill('{kept} {n}', { n: 1 }), '{kept} 1');
  useWords({}, 'en');
});
