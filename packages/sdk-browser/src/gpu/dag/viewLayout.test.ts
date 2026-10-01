import test from 'node:test';
import assert from 'node:assert/strict';
import { VIEW_BLOCK_WORDS, VIEW_UNIFORM_STRUCT, viewWord } from './viewLayout.ts';
import { DAG_VIEW_WORDS } from './shader/viewsWgsl.ts';
import { DAG_SELECTION_SHADER } from './shader/shader.ts';
import { writeDagUniforms } from './uniforms.ts';
import { createDagOutputScratch } from './uniforms.ts';

test('the block holds the sixty-four words the uniform array strides by', () => {
  assert.equal(VIEW_BLOCK_WORDS, 64);
  // The array is allocated from the same number the kernels index by: one source, no drift.
  assert.equal(DAG_VIEW_WORDS, VIEW_BLOCK_WORDS);
});

test('every field starts where WGSL puts it, by its own alignment', () => {
  // The words the host wrote by hand before the table existed, read from the merge that introduced
  // them. A table that moved one of them would move every word after it in the kernel's view.
  const asWritten: [string, number][] = [
    ['planes', 0],
    ['view', 24],
    ['pixelScale', 40],
    ['pixelError', 42],
    ['near', 43],
    ['clusterCount', 44],
    ['nodeCount', 45],
    ['worldCount', 46],
    ['residentCut', 47],
    // `cameraWorld` is a vec3: three words, but it waits for word 48 rather than starting at 47.
    ['cameraWorld', 48],
    ['cameraStretch', 51],
    ['listCap', 52],
    ['perspective', 53],
    ['viewFlags', 54],
    ['pageRows', 55],
    // `pageMask` is a vec2<u32>: two words at an eight-byte alignment.
    ['pageMask', 56],
    ['clipScale', 58],
    ['clipPad', 59],
    ['viewCount', 60],
    ['viewCapacity', 61],
    ['queueCap', 62],
    ['ahead', 63],
  ];
  for (const [field, word] of asWritten) assert.equal(viewWord(field), word, field);
});

test('a vec3 never starts inside a sixteen-byte boundary, which is the rule that bites', () => {
  // Add a scalar before `cameraWorld` and the vec3 must still land on a four-word boundary.
  assert.equal(viewWord('cameraWorld') % 4, 0);
  // Three words, 48 to 50, and the next field lands on 51: no padding word is invented.
  assert.equal(viewWord('cameraWorld') + 2, 50);
  assert.equal(viewWord('cameraStretch'), 51);
  // A vec2 takes two words at a two-word alignment, never one.
  assert.equal(viewWord('pageMask') % 2, 0);
  assert.equal(viewWord('pageMask') + 1, 57);
});

test('the struct the kernels bind is the one the table describes, in order', () => {
  assert.equal(
    VIEW_UNIFORM_STRUCT,
    'struct Uniforms{planes:array<vec4f,6>,view:mat4x4f,pixelScale:vec2f,pixelError:f32,' +
      'near:f32,clusterCount:u32,nodeCount:u32,worldCount:u32,residentCut:u32,cameraWorld:vec3f,' +
      'cameraStretch:f32,listCap:u32,perspective:f32,viewFlags:u32,pageRows:u32,pageMask:vec2<u32>,' +
      'clipScale:f32,clipPad:f32,viewCount:u32,viewCapacity:u32,queueCap:u32,ahead:u32,}',
  );
  // And the shipped shader carries that exact struct, not a copy of it.
  assert.ok(DAG_SELECTION_SHADER.includes(VIEW_UNIFORM_STRUCT));
  assert.equal(DAG_SELECTION_SHADER.match(/struct Uniforms\{/g)?.length, 1);
});

test('an unknown field is refused by name, never read as undefined', () => {
  assert.throws(() => viewWord('pageRow'), /pageRow is not a field/);
  assert.throws(() => viewWord(''), /is not a field/);
});

test('the host writes each field at the word the kernels read, values unchanged', () => {
  const target = new Float32Array(VIEW_BLOCK_WORDS);
  const packed = { pageCount: 11, nodeCount: 22, worldCount: 33 } as never;
  const uniforms = {
    planes: new Float32Array(24).fill(0.5),
    view: new Float32Array(16).fill(0.25),
    pixelScale: [2, 3],
    pixelError: 0.5,
    near: 0.1,
    cameraWorld: [7, 8, 9],
    cameraStretch: 1.5,
    ahead: undefined,
    light: undefined,
  } as never;
  writeDagUniforms(target, packed, uniforms, true, 64);

  assert.equal(target[viewWord('pixelScale')], 2);
  assert.equal(target[viewWord('pixelScale') + 1], 3);
  assert.equal(target[viewWord('pixelError')], 0.5);
  // A f32 word: the value is the nearest float to the double, so it is compared as one.
  assert.equal(new Float32Array([target[viewWord('near')]])[0], new Float32Array([0.1])[0]);
  assert.equal(target[viewWord('cameraWorld')], 7);
  assert.equal(target[viewWord('cameraWorld') + 2], 9);
  assert.equal(target[viewWord('cameraStretch')], 1.5);
  const ints = new Uint32Array(target.buffer);
  assert.equal(ints[viewWord('clusterCount')], 11);
  assert.equal(ints[viewWord('nodeCount')], 22);
  assert.equal(ints[viewWord('worldCount')], 33);
  assert.equal(ints[viewWord('residentCut')], 1);
  assert.equal(ints[viewWord('listCap')], 64);
  // A camera sends no light, so the light-only words stay at zero, as the struct's zero value.
  assert.equal(ints[viewWord('viewFlags')], 0);
  assert.equal(ints[viewWord('pageRows')], 0);
  assert.equal(ints[viewWord('ahead')], 0);
  // The planes and the matrix are copied whole, at their own first words.
  assert.equal(target[0], 0.5);
  assert.equal(target[viewWord('view')], 0.25);
});

test('a view ahead fills block one and raises the word that says it is there', () => {
  const AHEAD = 1;
  const target = new Float32Array(VIEW_BLOCK_WORDS * 2);
  const base = {
    planes: new Float32Array(24).fill(1),
    view: new Float32Array(16).fill(1),
    pixelScale: [1, 1],
    pixelError: 0.5,
    near: 0.1,
    cameraStretch: 1,
  } as never;
  const uniforms = {
    ...base,
    ahead: { planes: new Float32Array(24).fill(9), view: new Float32Array(16).fill(9) },
  } as never;
  writeDagUniforms(
    target,
    { pageCount: 1, nodeCount: 1, worldCount: 1 } as never,
    uniforms,
    false,
    8,
  );
  const at = AHEAD * VIEW_BLOCK_WORDS;
  assert.equal(target[at], 9, 'block one repeats the ahead block’s planes');
  assert.equal(target[at + viewWord('view')], 9);
  assert.equal(new Uint32Array(target.buffer)[viewWord('ahead')], 1);
  assert.equal(new Uint32Array(target.buffer)[AHEAD * VIEW_BLOCK_WORDS + viewWord('ahead')], 0);
});

test('a light cut fills the words a camera leaves at zero', () => {
  const target = new Float32Array(VIEW_BLOCK_WORDS);
  const uniforms = {
    planes: new Float32Array(24),
    view: new Float32Array(16),
    pixelScale: [1, 1],
    pixelError: 0.5,
    near: 0.1,
    cameraStretch: 1,
    light: { rows: 5, mask: [0b1010, 0b0101], clipScale: 2, clipPad: 3 },
  } as never;
  writeDagUniforms(
    target,
    { pageCount: 4, nodeCount: 6, worldCount: 7 } as never,
    uniforms,
    false,
    16,
    { count: 2, capacity: 3, queueCap: 5, append: true },
  );
  const ints = new Uint32Array(target.buffer);
  assert.equal(ints[viewWord('pageRows')], 5);
  assert.equal(ints[viewWord('pageMask')], 0b1010);
  assert.equal(ints[viewWord('pageMask') + 1], 0b0101);
  assert.equal(target[viewWord('clipScale')], 2);
  assert.equal(target[viewWord('clipPad')], 3);
  assert.equal(ints[viewWord('viewCount')], 2);
  assert.equal(ints[viewWord('viewCapacity')], 3);
  assert.equal(ints[viewWord('queueCap')], 5);
  // `VIEW_LIGHT | VIEW_PAGES | VIEW_APPEND`, the three bits the pages kernel reads.
  assert.notEqual(ints[viewWord('viewFlags')], 0);
  // The scratch is a readback detail, unchanged by the layout.
  assert.deepEqual(createDagOutputScratch().result.lodLevel, 0);
});
