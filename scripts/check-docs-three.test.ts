import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryMentions } from './check-docs-three.ts';

test('a sentence describing the engine in Three.js terms is refused, with its line', () => {
  const doc = '# Guide\n\n## Lights\n\nThe lights are copied into a Three.js scene.\n';
  assert.deepEqual(libraryMentions(doc), [
    { line: 5, text: 'The lights are copied into a Three.js scene.' },
  ]);
});

test('every spelling of the library is caught', () => {
  for (const line of [
    'uses THREE.LOD',
    'install `three` first',
    "import from 'three/addons'",
    'add @types/three',
    'the same as Three does',
    "the witness is Three's renderer",
  ])
    assert.equal(libraryMentions(`# Guide\n\n${line}\n`).length, 1, line);
});

test('the number three and a capitalised sentence start pass', () => {
  const doc = '# Guide\n\nThree streams, nothing else: the three passes.\n| Three kinds |\n';
  assert.deepEqual(libraryMentions(doc), []);
});

test('a witness, benchmark, measurement or migration section may name it, down its subsections', () => {
  const doc = [
    '# Guide',
    '## The witnesses',
    '### Lights',
    'Three.js copies the lights.',
    '## Migration from Three.js',
    'A host drops `three`.',
    '## Measuring',
    'bare Three.js',
    '## Lights',
    'Three.js is back.',
  ].join('\n');
  assert.deepEqual(libraryMentions(doc), [{ line: 10, text: 'Three.js is back.' }]);
});

test('a heading that merely contains a word like "bench" allows nothing', () => {
  const doc = '# Engine\n### A bench that proves every number\n[![Three.js 0.174](badge)](x)\n';
  assert.equal(libraryMentions(doc).length, 1);
});

test('a heading inside a code fence opens no section', () => {
  const doc = '# Guide\n\n```sh\n# witness setup\n```\nThree.js here.\n';
  assert.deepEqual(libraryMentions(doc), [{ line: 6, text: 'Three.js here.' }]);
});
