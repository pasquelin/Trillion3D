import test from 'node:test'
import assert from 'node:assert/strict'
import { VIEW_BLOCK_WORDS, VIEW_UNIFORM_STRUCT, viewWord, type FieldName } from './viewLayout.ts'
import { DAG_SELECTION_SHADER } from './shader/selectionShader.fixture.ts'
import { writeDagUniforms } from './uniforms.ts'
import { CULL_DRAW_DISTANCE_OFF, CULL_NO_DRAW_DISTANCES } from './shader/viewsWgsl.ts'

/** The view a packing names, with nothing but the fields every view carries. */
const plainView = () => ({
  planes: new Float32Array(24),
  view: new Float32Array(16),
  pixelScale: [1, 1],
  pixelError: 1,
  near: 0.1,
  cameraWorld: [0, 0, 0],
  viewProj: new Float32Array(16),
  depthMap: [-1, 0.2],
  viewSize: [1280, 720],
  clipPlane: [0, 0, 0, 0],
})

test('the block holds the hundred and twenty-eight words the host allocates', () => {
  assert.equal(VIEW_BLOCK_WORDS, 128)
  // The buffer is allocated from the same number the kernels read by: one source, no drift.
})

test('every field starts where WGSL puts it, by its own alignment', () => {
  // Each field's word by WGSL's struct rules. A table that moved one of them would move every word
  // after it in the kernel's view.
  const asWritten: [FieldName, number][] = [
    ['planes', 0],
    ['view', 24],
    // The render matrices the occlusion projects a box with, now and at the image before.
    ['viewProj', 40],
    ['prevViewProj', 56],
    ['pixelScale', 72],
    ['pixelError', 74],
    ['near', 75],
    // Each projection's clip depth, then the view's size now and then: vec2s, two words each.
    ['depthMap', 76],
    ['prevDepthMap', 78],
    ['viewSize', 80],
    ['prevSize', 82],
    ['clusterCount', 84],
    ['nodeCount', 85],
    ['worldCount', 86],
    // What the occlusion runs and the culls the host turned off (`shader/viewsWgsl.ts`).
    ['occlusion', 87],
    ['cullOff', 88],
    // The visible list's cap and the nodes one pass opens (`shader/listsWgsl.ts`).
    ['visCap', 89],
    ['nodeBudget', 90],
    // The tree's members drawn whatever the view, in the word `cameraWorld`'s alignment leaves; the
    // vec3 itself waits for word 92 rather than starting at 91.
    ['alwaysCount', 91],
    ['cameraWorld', 92],
    ['listCap', 95],
    ['perspective', 96],
    ['queueCap', 97],
    // The placement tree's two words, the world's link base. The tree's order and list
    // lie in its own table (`tree/treeTable.ts`), the world DAG's placements among its members drawn
    // whatever the view: no word names them.
    ['treeTop', 98],
    ['cellBase', 99],
    ['worldLinks', 100],
    // The open counts placements hold (`heldOpen.ts`) and the lists' entries.
    ['heldBase', 101],
    ['heldMask', 102],
    ['candCap', 103],
    // The two scales of the draw distances, the instances' and the objects of their own's: no word
    // behind them moves.
    ['viewDistanceScale', 104],
    ['primitiveDistanceScale', 105],
    ['eye', 108],
    // Behind them, the view's clip plane, a vec4 on its own boundary, and where its filter's bits
    // start in `work` (`shader/clipPlaneWgsl.ts`, `shader/viewFilterWgsl.ts`).
    ['clipPlane', 116],
    ['filterBase', 120],
    // What the cluster cull judges the rasters by (`shader/visibleWgsl.ts`).
    ['hardwareEdge', 121],
    ['softwareRaster', 122],
    ['tessellation', 123],
    ['depthBuckets', 124],
    ['bucketMinZ', 125],
    ['bucketMaxZ', 126],
  ]
  for (const [field, word] of asWritten) assert.equal(viewWord(field), word, field)
})

test('a vec3 never starts inside a sixteen-byte boundary, which is the rule that bites', () => {
  // Add a scalar before `cameraWorld` and the vec3 must still land on a four-word boundary.
  assert.equal(viewWord('cameraWorld') % 4, 0)
  // Three words, 92 to 94, and the next field lands on 95: no padding word is invented.
  assert.equal(viewWord('cameraWorld') + 2, 94)
  assert.equal(viewWord('listCap'), 95)
  // A vec2 takes two words at a two-word alignment, never one.
  assert.equal(viewWord('pixelScale') % 2, 0)
  assert.equal(viewWord('pixelScale') + 2, viewWord('pixelError'))
})

test('the struct the kernels bind is the one the table describes, in order', () => {
  assert.equal(
    VIEW_UNIFORM_STRUCT,
    'struct Uniforms{planes:array<vec4f,6>,view:mat4x4f,viewProj:mat4x4f,prevViewProj:mat4x4f,' +
      'pixelScale:vec2f,pixelError:f32,near:f32,' +
      'depthMap:vec2f,prevDepthMap:vec2f,viewSize:vec2u,prevSize:vec2u,' +
      'clusterCount:u32,nodeCount:u32,worldCount:u32,occlusion:u32,cullOff:u32,' +
      'visCap:u32,nodeBudget:u32,alwaysCount:u32,cameraWorld:vec3f,' +
      'listCap:u32,perspective:f32,queueCap:u32,' +
      'treeTop:u32,cellBase:u32,worldLinks:u32,' +
      'heldBase:u32,heldMask:u32,candCap:u32,viewDistanceScale:f32,primitiveDistanceScale:f32,' +
      'eye:array<vec4u,2>,clipPlane:vec4f,filterBase:u32,' +
      'hardwareEdge:f32,softwareRaster:u32,tessellation:u32,depthBuckets:u32,bucketMinZ:f32,bucketMaxZ:f32,}',
  )
  // And the shipped shader carries that exact struct, not a copy of it.
  assert.ok(DAG_SELECTION_SHADER.includes(VIEW_UNIFORM_STRUCT))
  assert.equal(DAG_SELECTION_SHADER.match(/struct Uniforms\{/g)?.length, 1)
})

test('a field the table does not name is a type error, not a lookup that returns undefined', () => {
  // `viewWord` takes the union of the table's names, so `viewWord('pageRows')` and
  // `viewWord('cameraWrold')` do not compile — checked by `tsc` on this file, which is why they are
  // spelled here as strings the compiler sees. The runtime guard below is what a JavaScript caller
  // reaches, and it names the field rather than writing into word `undefined`.
  const asText = viewWord as (field: string) => number
  assert.throws(() => asText('pageRows'), /pageRows is not a field/)
  assert.throws(() => asText(''), /is not a field/)
})

test('the host writes each field at the word the kernels read, values unchanged', () => {
  const target = new Float32Array(VIEW_BLOCK_WORDS)
  const packed = { pageCount: 11, nodeCount: 22, worldCount: 33 } as never
  const named = {
    planes: new Float32Array(24).fill(0.5),
    view: new Float32Array(16).fill(0.25),
    pixelScale: [2, 3],
    pixelError: 0.5,
    near: 0.1,
    cameraWorld: [7, 8, 9],
    viewProj: new Float32Array(16).fill(0.125),
    depthMap: [-1, 0.2],
    viewSize: [1280, 720],
    clipPlane: [0, 0, 0, 0],
  }
  writeDagUniforms(target, packed, named as never, 64)
  // No scale named, the draw distances are taken at their own size.
  assert.equal(target[viewWord('viewDistanceScale')], 1)
  assert.equal(target[viewWord('primitiveDistanceScale')], 1)
  writeDagUniforms(
    target,
    packed,
    { ...named, viewDistanceScale: 2.5, primitiveDistanceScale: 0.75 } as never,
    64,
  )
  assert.equal(target[viewWord('viewDistanceScale')], 2.5)
  assert.equal(target[viewWord('primitiveDistanceScale')], 0.75)
  writeDagUniforms(target, packed, named as never, 64)

  assert.equal(target[viewWord('pixelScale')], 2)
  assert.equal(target[viewWord('pixelScale') + 1], 3)
  assert.equal(target[viewWord('pixelError')], 0.5)
  // A f32 word: the value is the nearest float to the double, so it is compared as one.
  assert.equal(new Float32Array([target[viewWord('near')]])[0], new Float32Array([0.1])[0])
  assert.equal(target[viewWord('cameraWorld')], 7)
  assert.equal(target[viewWord('cameraWorld') + 2], 9)
  assert.equal(target[viewWord('viewProj')], 0.125)
  const ints = new Uint32Array(target.buffer)
  assert.equal(ints[viewWord('clusterCount')], 11)
  assert.equal(ints[viewWord('nodeCount')], 22)
  assert.equal(ints[viewWord('worldCount')], 33)
  assert.equal(ints[viewWord('listCap')], 64)
  assert.deepEqual([ints[viewWord('viewSize')], ints[viewWord('viewSize') + 1]], [1280, 720])
  // No occlusion asked, so its word stays at zero, as the struct's zero value.
  assert.equal(ints[viewWord('occlusion')], 0)
  // The planes and the matrix are copied whole, at their own first words.
  assert.equal(target[0], 0.5)
  assert.equal(target[viewWord('view')], 0.25)
})

test('a packing that names no draw distance says so, one that names any does not; the host’s switch is its own bit', () => {
  const target = new Float32Array(VIEW_BLOCK_WORDS)
  const named = plainView()
  const cullOff = () => new Uint32Array(target.buffer)[viewWord('cullOff')]
  writeDagUniforms(target, { worldCount: 2 } as never, named as never, 64)
  assert.equal(
    cullOff(),
    CULL_NO_DRAW_DISTANCES,
    'only that bit: the instances’ switch is the host’s',
  )
  const drawDistance = new Float32Array(4)
  writeDagUniforms(target, { worldCount: 2, drawDistance } as never, named as never, 64)
  assert.equal(cullOff(), 0)
  writeDagUniforms(
    target,
    { worldCount: 2, drawDistance } as never,
    { ...named, cullOff: CULL_DRAW_DISTANCE_OFF } as never,
    64,
  )
  assert.equal(cullOff(), CULL_DRAW_DISTANCE_OFF)
})

test('a view’s plane and the region of its filter reach the block, none for a view without them', () => {
  const target = new Float32Array(VIEW_BLOCK_WORDS)
  const named = plainView()
  const at = { base: 0, mask: 0, filter: 5000 },
    packed = { worldCount: 2 } as never
  const plane = () => Array.from(target.subarray(viewWord('clipPlane'), viewWord('clipPlane') + 4))
  const filter = () => new Uint32Array(target.buffer)[viewWord('filterBase')]
  writeDagUniforms(target, packed, named as never, 64, at)
  assert.deepEqual(plane(), [0, 0, 0, 0], 'no plane: all zero, which the cut reads as none')
  assert.equal(filter(), 0, 'no filter: no region named')
  const bits = new Uint32Array(1)
  writeDagUniforms(
    target,
    packed,
    { ...named, clipPlane: [0, 1, 0, -2.5], filter: bits } as never,
    64,
    at,
  )
  assert.deepEqual(plane(), [0, 1, 0, -2.5])
  assert.equal(
    filter(),
    5000,
    'the region the layout allocates, named by the view that has a filter',
  )
  // A cut written again for a view without them clears both: the block is rewritten whole.
  writeDagUniforms(target, packed, named as never, 64, at)
  assert.deepEqual(plane(), [0, 0, 0, 0])
  assert.equal(filter(), 0)
})
