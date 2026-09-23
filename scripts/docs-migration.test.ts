import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadReactComponents } from './docs/render-react.ts';
import * as publicApi from '../packages/sdk/browser.ts';
import type { ThreeMigration as ThreeMigrationPage } from '../site/app/migration/ThreeMigration.tsx';

// #79: the migration page sets a Three.js program (text, never run) beside the engine program
// that does the same; the second is a real example file, on the public API alone.
const engineProgram = await readFile(
  new URL('../site/examples/migrating-from-three.html', import.meta.url),
  'utf8',
);
const threeProgram = await readFile(
  new URL('../site/content/migration/three-scene.txt', import.meta.url),
  'utf8',
);
const sections = (program: string) =>
  [...program.matchAll(/^\s*\/\/ --- (.+)$/gm)].map(([, name]) => name);

test('every symbol the engine program uses is a public export of trillion3d', () => {
  const imported = engineProgram.match(/import \{([^}]+)\} from '\.\.\/runtime\/engine\.js'/)?.[1];
  assert.ok(imported, 'the program imports the built engine');
  const names = imported.split(',').map((name) => name.trim());
  const exports = publicApi as Record<string, unknown>;
  const missing: string[] = [];
  for (const name of names) {
    if (!(name in exports)) {
      missing.push(name);
      continue;
    }
    // A family member (`geometry.box`, `light.spot`) must exist on the family the program imports.
    for (const [, member] of engineProgram.matchAll(new RegExp(`(?<![\\w.])${name}\\.(\\w+)`, 'g')))
      if (!(member in (exports[name] as object))) missing.push(`${name}.${member}`);
  }
  assert.deepEqual(missing, []);
});

test('both programs carry the same section headers in the same order', () => {
  const engine = sections(engineProgram);
  assert.ok(engine.length >= 10, `${engine.length} sections`);
  assert.deepEqual(sections(threeProgram), engine);
  // The left-hand program is text: the repository never imports Three.js to run it.
  assert.match(threeProgram, /import \* as THREE from 'three';/);
  assert.doesNotMatch(engineProgram, /from 'three/);
});

test('the guide page is the two programs side by side, each header on the same row', async () => {
  const { ThreeMigration } = (await loadReactComponents(
    'site/app/migration/ThreeMigration.tsx',
  )) as { ThreeMigration: typeof ThreeMigrationPage };
  const entry = {
    id: 'three-migration',
    section: 'guides',
    kind: 'Guide',
    title: 'T',
    description: 'D',
  };
  const page = renderToStaticMarkup(createElement(ThreeMigration, { entry, locale: 'en' }));
  const blocks = page.split('data-code-block').slice(1);
  assert.equal(blocks.length, 2);
  assert.match(blocks[0], /THREE/);
  assert.match(blocks[1], /runtime\/engine\.js/);
  // A header's row is its position among the rendered rows, blank padding rows included.
  const headerRows = (block: string) =>
    [...block.matchAll(/<pre[^>]*>.*?<\/pre>/gs)].flatMap(([row], at) =>
      row.includes('// --- ') ? [at] : [],
    );
  assert.equal(headerRows(blocks[0]).length, sections(threeProgram).length);
  assert.deepEqual(headerRows(blocks[0]), headerRows(blocks[1]));
});
