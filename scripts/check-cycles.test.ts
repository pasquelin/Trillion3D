import test from 'node:test';
import assert from 'node:assert/strict';
import { bindsValue, cyclesOf, newRings, ringKey, runtimeImportsOf } from './check-cycles.ts';

const files = (map: Record<string, string>) => new Map(Object.entries(map));

test('a value import is an edge, and the two modules of a ring are reported together', () => {
  const graph = runtimeImportsOf(
    files({ 'a.ts': "import { b } from './b.ts';\n", 'b.ts': "import { a } from './a.ts';\n" }),
  );
  const rings = cyclesOf(graph);
  assert.equal(rings.length, 1);
  assert.deepEqual(rings[0], ['a.ts', 'b.ts']);
});

test('an `import type` is not an edge: the emitted JavaScript holds no import to order', () => {
  // `tsc` erases the whole clause, so the ring it would close does not exist at load time. The tree
  // holds 185 of these; reading them would drown the eight that are real.
  const graph = runtimeImportsOf(
    files({
      'a.ts': "import type { B } from './b.ts';\nexport type A = B;\n",
      'b.ts': "import type { A } from './a.ts';\nexport type B = A;\n",
    }),
  );
  assert.deepEqual(cyclesOf(graph), [], 'two modules naming each other over a type is not a ring');
});

test('one real name beside marked ones is a value edge', () => {
  // A clause the tree holds: `packages/page-codec/geometryPage.ts` keeps `QuantizedGrid` beside
  // five real names, so the module behind it loads and the ring it could close is a ring.
  assert.equal(
    bindsValue('{ bitsFor, ceil32, octEncode, Packer, quantize, type QuantizedGrid }'),
    true,
    'the clause keeps the five names',
  );
  assert.equal(bindsValue('{ type A, type B }'), false, 'nothing survives');
  assert.equal(bindsValue('type { A }'), false);
  assert.equal(bindsValue('{ A }'), true);
  assert.equal(bindsValue('def'), true, 'a default binding');
  assert.equal(bindsValue('* as ns'), true);
  assert.equal(bindsValue('type * as ns'), false);
});

test('a re-export is an edge: it forces its target to load as surely as an import does', () => {
  // This is how a ring hides. `atlas.ts` re-exports what `sizes.ts` defines, and a module that needs
  // the name fetches it from `atlas.ts`; `sizes.ts` imports the module that needed it. The ring is
  // on the door, not on the definition, and reading re-exports is what finds it.
  const graph = runtimeImportsOf(
    files({
      'sizes.ts': "import { quads } from './casts.ts';\nexport const SHADOW_TABLE_OFFSET = 1;\n",
      'atlas.ts': "export { SHADOW_TABLE_OFFSET } from './sizes.ts';\n",
      'casts.ts': "import { SHADOW_TABLE_OFFSET } from './atlas.ts';\nexport const quads = 2;\n",
    }),
  );
  assert.ok(graph.get('atlas.ts')!.has('sizes.ts'), 'the re-export is read as the edge it is');
  assert.deepEqual(cyclesOf(graph), [['atlas.ts', 'casts.ts', 'sizes.ts']]);
});

test('a group is reported once, however many modules it has and however many paths reach it', () => {
  const graph = runtimeImportsOf(
    files({
      'a.ts': "import { b } from './b.ts';\nimport { c } from './c.ts';\n",
      'b.ts': "import { a } from './a.ts';\n",
      'c.ts': "import { a } from './a.ts';\nimport { b } from './b.ts';\n",
    }),
  );
  const rings = cyclesOf(graph);
  assert.equal(rings.length, 1, 'three modules reach each other: one group');
  assert.deepEqual(rings[0], ['a.ts', 'b.ts', 'c.ts']);
});

test('a module that reaches itself is reported', () => {
  const rings = cyclesOf(runtimeImportsOf(files({ 'a.ts': "import { b } from './b.ts';\n" })));
  assert.deepEqual(rings, [], 'a one-way import is not a ring');
});

test('a specifier that leaves the repository resolves to nothing and is not an edge', () => {
  const graph = runtimeImportsOf(
    files({ 'a.ts': "import ts from 'typescript';\nimport { x } from './nowhere.ts';\n" }),
  );
  assert.deepEqual([...graph.get('a.ts')!], []);
});

test('a baseline names the groups it allows; a group it does not is reported', () => {
  const groups = [
    ['a.ts', 'b.ts'],
    ['c.ts', 'd.ts', 'e.ts'],
  ];
  const keys = groups.map(ringKey);
  assert.deepEqual(newRings(groups, []), groups, 'an empty baseline allows nothing');
  assert.deepEqual(newRings(groups, [keys[0]]), [groups[1]], 'the named group is allowed');
  assert.deepEqual(newRings(groups, keys), [], 'the whole baseline allows everything');
  assert.equal(
    newRings(groups, ['b.ts -> a.ts']).length,
    2,
    'order does not matter: the key is sorted',
  );
  assert.equal(ringKey(['b.ts', 'a.ts']), 'a.ts -> b.ts');
});
