import test from 'node:test';
import assert from 'node:assert/strict';
import { onDemand } from './onDemand.ts';

test('a module on demand is imported once, on the first read, and read once it has arrived', async () => {
  let imports = 0;
  const code = onDemand(async () => (imports++, { name: 'fluids' }));
  await code.settled();
  assert.equal(imports, 0, 'nothing read, nothing imported');
  assert.equal(code.get(), undefined, 'the frame that asks first draws without it');
  assert.equal(code.get(), undefined);
  await code.settled();
  assert.deepEqual([code.get(), imports, code.failed], [{ name: 'fluids' }, 1, undefined]);
});

test('a module whose import is refused names why, and is never read', async () => {
  const code = onDemand(() => Promise.reject(new Error('CHUNK_MISSING')));
  code.get();
  await code.settled();
  assert.deepEqual([code.get(), code.failed?.message], [undefined, 'CHUNK_MISSING']);
});
