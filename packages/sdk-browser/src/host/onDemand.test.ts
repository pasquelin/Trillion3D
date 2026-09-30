import test from 'node:test';
import assert from 'node:assert/strict';
import { onDemand } from './onDemand.ts';

test('a module on demand is imported once, on the first read, and read once it has arrived', async () => {
  let imports = 0;
  const code = onDemand(async () => (imports++, { name: 'particles' }));
  await code.settled();
  assert.equal(imports, 0, 'nothing read, nothing imported');
  assert.equal(code.get(), undefined, 'asked, it is on its way');
  assert.equal(code.arrived, false);
  await code.settled();
  assert.deepEqual([code.get(), code.arrived, imports], [{ name: 'particles' }, true, 1]);
  assert.deepEqual(await code.load(), { name: 'particles' });
  assert.equal(imports, 1);
});

test('a module whose import is refused names why, and is never read', async () => {
  const code = onDemand(() => Promise.reject(new Error('CHUNK_MISSING')));
  await assert.rejects(code.load(), /CHUNK_MISSING/);
  assert.deepEqual(
    [code.get(), code.arrived, code.failed?.message],
    [undefined, true, 'CHUNK_MISSING'],
  );
});
