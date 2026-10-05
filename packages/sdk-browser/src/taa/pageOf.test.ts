// The page record a pixel's identifier names is indexed once, by `pageOf`: the identity the
// geometry history keeps and the dynamic test both come from that one read (`historyWgsl.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { functionText } from '../bounce/wgslBody.fixture.ts';
import { FLAG_DYNAMIC } from '../visibility/types.ts';
import { PAGE_OF_WGSL } from './historyWgsl.ts';
import { taaShader } from './shaderWgsl.ts';
import { taaUpscaleShader } from './upscaleWgsl.ts';
import { taaBuiltins } from './taaBuiltins.fixture.ts';

type Page = { placement: number; flags: number; deformOutput: number };
type PageOf = (id: number) => { identity: number; animated: number };

/** `pageOf` over `records`, and the table indexes it made. */
function run(records: Page[]) {
  const indexed: number[] = [];
  const pages = new Proxy(records, {
    get: (table, key) => (
      typeof key === 'string' && /^\d+$/.test(key) && indexed.push(+key),
      table[key as never]
    ),
  });
  const { pageOf } = shaderRun<{ pageOf: PageOf }>(PAGE_OF_WGSL, ['pageOf'], {
    ...taaBuiltins,
    pages,
  });
  return { pageOf, indexed };
}
const page = (placement: number, flags = 0, deformOutput = 0): Page => ({
  placement,
  flags,
  deformOutput,
});

test('history identity distinguishes placements separated by 255 and preserves the sky', () => {
  const { pageOf, indexed } = run([page(0), page(255), page(0xffffff)]);
  assert.equal(pageOf(0).identity, 0);
  assert.deepEqual(indexed, [], 'the background names no row: none is read');
  assert.notEqual(pageOf(1 << 8).identity, pageOf(2 << 8).identity);
  assert.equal(pageOf(3 << 8).identity, 0x1000000);
});

test('a pixel is animated where its geometry changes with no tracked deformation', () => {
  const { pageOf } = run([page(0), page(0, FLAG_DYNAMIC), page(0, FLAG_DYNAMIC, 7), page(0, 0, 7)]);
  // The sky first, then each row's page, the triangle bits of the identifier below its row.
  const ids = [0, 1, 2, 3, 4].map((row) => (row ? (row << 8) | 0x2a : 0));
  assert.deepEqual(
    ids.map((id) => pageOf(id).animated),
    [0, 0, 1, 0, 0],
  );
});

test('the record is indexed once for the identity and the dynamic test together', () => {
  const { pageOf, indexed } = run([page(4, FLAG_DYNAMIC), page(9, FLAG_DYNAMIC, 3)]);
  for (const id of [1 << 8, (2 << 8) | 5]) {
    indexed.length = 0;
    pageOf(id);
    assert.deepEqual(indexed, [(id >> 8) - 1], `identifier ${id}`);
  }
});

test('each resolve reads the record once, and no function of its own indexes the table again', () => {
  for (const [name, shader, main] of [
    ['native, fragment', taaShader(false, false, false, true), 'resolve'],
    ['upscaling, fragment', taaUpscaleShader(false, false, false, true), 'resolve'],
  ] as const) {
    const calls = (text: string, call: string) => text.split(call).length - 1;
    assert.equal(calls(functionText(shader, 'pageOf'), 'pages['), 1, `${name}: pageOf`);
    const body = functionText(shader, main);
    assert.equal(calls(body, 'pageOf('), 1, `${name}: ${main} asks the page once`);
    for (const gone of ['pages[', 'placementOf(', 'dynamicPixel(', 'geometryIdentity(']) {
      assert.equal(calls(body, gone), 0, `${name}: ${main} has no ${gone}`);
    }
    assert.equal(calls(shader, 'fn dynamicPixel('), 0);
    assert.equal(calls(shader, 'fn geometryIdentity('), 0);
  }
});
