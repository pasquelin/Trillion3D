import test from 'node:test';
import assert from 'node:assert/strict';
import { Material } from './material.ts';
import { Color } from '../math/color.ts';

test('a color shared by two slots stays observed until both slots release it', () => {
  const color = new Color(0x123456),
    material = new Material('meshStandard', { color, emissive: color });
  let writes = 0;
  material._listeners.add(() => writes++);
  material.color = new Color(0xffffff);
  writes = 0;
  color.set(0x112233);
  assert.equal(writes, 1);
  assert.deepEqual(material.emissive.toArray(), color.toArray());
  material.emissive = new Color(0x111111);
  writes = 0;
  color.set(0xaabbcc);
  assert.equal(writes, 0);
});

test('a newly created optional color continues to notify its material after construction', () => {
  const material = new Material('meshPhong', { specular: 0x112233 });
  let writes = 0;
  material._listeners.add(() => writes++);
  (material.specular as Color).set(0x334455);
  assert.equal(writes, 1);
  material.sheenColor = 0xffaa00;
  writes = 0;
  (material.sheenColor as Color).set(0xff0000);
  assert.equal(writes, 1);
});
