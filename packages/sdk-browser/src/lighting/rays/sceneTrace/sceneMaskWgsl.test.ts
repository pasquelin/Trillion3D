// The any-hit test of the masked surfaces: its bindings sit past the trace's four, the program that lists it replaces the default that keeps every triangle, and a mask is read from the material words.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { material } from '../../../../../sdk-core/src/world/material/index.ts'
import { graphRastersOf, NO_RASTERS } from '../../../materials/graph/graphRasters.ts'
import { NO_SCENE_MASKS, sceneMaskKey, sceneMaskProgramsOf } from './sceneMaskPrograms.ts'
import {
  SCENE_MASK_END,
  sceneMaskBindings,
  sceneMaskLayoutEntries,
  sceneMaskWgsl,
} from './sceneMaskWgsl.ts'
import { sceneTraceWgsl } from './sceneTraceWgsl.ts'
import {
  TRACED_MASK_FLAGS,
  TRACED_MASK_SET_SHIFT,
  writeTracedMaterial,
  TRACED_MATERIAL_AT as A,
  TRACED_MATERIAL_WORDS,
} from '../../reflections/translucency/materialWords.ts'

const surface = {
  baseColor: [1, 1, 1],
  metalness: 0,
  roughness: 1,
  emissive: [0, 0, 0],
  opacity: 0.9,
}

test('the bindings follow the scene trace’s three: the lanes and pages of the colour atlas, the sampler, the surfaces’ records and the graph frame', () => {
  const b = sceneMaskBindings(2)
  assert.deepEqual(b.color.lanes, [5, 6, 7])
  assert.equal(b.color.pages, 8)
  assert.equal(b.sampler, 9)
  assert.equal(b.table, 10)
  assert.equal(b.frame, 11)
  const bindings = sceneMaskLayoutEntries(2).map((entry) => entry.binding)
  assert.deepEqual(bindings, [5, 6, 7, 8, 9, 10, 11])
  assert.equal(SCENE_MASK_END, 10)
})

test('a program that lists the mask holds its test once, in place of the default that keeps every triangle', () => {
  const text = wgslProgram('', [sceneTraceWgsl(0, 0), sceneMaskWgsl(0, 0)])
  assert.equal(text.match(/fn stMaskKeeps\(/g)?.length, 1)
  assert.match(text, /fn stMaskKeeps[^{]*\{\s*let flags=/)
  assert.match(text, /stMaskKeeps\(inst\.placement,inst\.record,ti,/)
  const plain = wgslProgram('', [sceneTraceWgsl(0, 0)])
  assert.match(plain, /fn stMaskKeeps\([^)]*\)->bool\{return true;\}/)
})

test('a ray that forces every surface opaque skips the test', () => {
  assert.match(
    wgslProgram('', [sceneTraceWgsl(0, 0)]),
    /\(stRay\.flags&ST_FORCE_OPAQUE\)==0u&&!stMaskKeeps/,
  )
})

test('a placement’s cutout is written beside its material: the threshold, the slot and the bits', () => {
  const out = new Float32Array(TRACED_MATERIAL_WORDS)
  const flags = TRACED_MASK_FLAGS.masked | TRACED_MASK_FLAGS.mapped
  writeTracedMaterial(out, 0, surface, { cut: 0.5, map: 7, flags })
  const words = new Uint32Array(out.buffer)
  assert.equal(out[A.cut], 0.5)
  assert.equal(words[A.map], 7)
  assert.equal(words[A.mask], flags)
  writeTracedMaterial(out, 0, surface)
  assert.equal(words[A.mask], 0, 'a surface that is not cut has none')
})

test('a cutout whose base map reads a texture set past the first takes the cutout coordinate of the corners where the record names that set', () => {
  const text = wgslProgram('', [sceneTraceWgsl(0, 0), sceneMaskWgsl(0, 0)])
  assert.match(
    text,
    new RegExp(
      `stMaskCorner\\(triangle,record,flags,[^;]*\\(bits>>${TRACED_MASK_SET_SHIFT}u\\)&7u,`,
    ),
  )
  assert.match(text, /let carried=uvSet!=0u&&uvSet==named;/)
  assert.match(text, /stTable\[stParams\.maskWord\+cutout\]/)
  const out = new Float32Array(TRACED_MATERIAL_WORDS)
  const flags = TRACED_MASK_FLAGS.masked | TRACED_MASK_FLAGS.mapped | (6 << TRACED_MASK_SET_SHIFT)
  writeTracedMaterial(out, 0, surface, { cut: 0.5, map: 7, flags })
  assert.equal(new Uint32Array(out.buffer)[A.mask], flags)
})

test('a surface cut by its graph is kept whole by a test without the graph’s program, and cut by the graph’s mask where the program is listed', () => {
  const none = wgslProgram('', [sceneTraceWgsl(1, 0), sceneMaskWgsl(1, 0)])
  assert.match(
    none,
    new RegExp(`if\\(\\(bits&${TRACED_MASK_FLAGS.graph}u\\)!=0u\\)\\{return true;\\}`),
  )
  assert.doesNotMatch(none, /maskGraphValue/)
  const graph = material.graph('surface')
  graph.output('baseColor', graph.constant(1, 0, 0))
  graph.output('opacityMask', graph.sine(graph.time(), 2))
  const programs = sceneMaskProgramsOf(graphRastersOf([{ graph }]))
  assert.equal(programs.length, 1)
  const text = wgslProgram('', [sceneTraceWgsl(1, 0), sceneMaskWgsl(1, 0, programs)])
  const b = sceneMaskBindings(0)
  assert.match(
    text,
    /return maskGraphValue\(materialAt\(stTable\[at\+17u\]\),uv,vec2f\(0\.0\),vec2f\(0\.0\)\)>=0\.0;/,
  )
  assert.match(
    text,
    new RegExp(`@group\\(1\\) @binding\\(${b.table}\\) var materialTable:texture_2d_array<u32>;`),
  )
  assert.match(
    text,
    new RegExp(`@group\\(1\\) @binding\\(${b.frame}\\) var<uniform> graphFrame:GraphFrame;`),
  )
  assert.equal(sceneMaskProgramsOf(graphRastersOf([{ graph }])).length, 1)
})

test('the programs the rays cut by are the cutting ones of the session’s rasters, the same array for the same rasters', () => {
  assert.equal(sceneMaskProgramsOf(NO_RASTERS), NO_SCENE_MASKS)
  const graph = material.graph('surface')
  graph.output('baseColor', graph.constant(1, 0, 0))
  graph.output('opacityMask', graph.constant(1))
  // Asked every frame of the same rasters, the set is found by the rasters' array, not filtered and sorted again.
  const rasters = graphRastersOf([{ graph }])
  assert.equal(sceneMaskProgramsOf(rasters), sceneMaskProgramsOf(rasters))
})

test('rasters that made another array of programs cutting by the same ones give the set made before', () => {
  const graph = material.graph('surface')
  graph.output('baseColor', graph.constant(1, 0, 0))
  graph.output('opacityMask', graph.constant(1))
  const first = graphRastersOf([{ graph }])
  const set = sceneMaskProgramsOf(first)
  const again: typeof first = { ...first, pixelPrograms: [...first.pixelPrograms] }
  assert.equal(sceneMaskProgramsOf(again), set)
})

test('a mapped or graph-cut surface on a triangle without corner attributes is read at the coordinate zero, as a mesh without a texture set is drawn', () => {
  const text = wgslProgram('', [sceneTraceWgsl(0, 0), sceneMaskWgsl(0, 0)])
  assert.match(text, /var uv=vec2f\(0\.0\);\s*var vertexAlpha=1\.0;/)
  assert.doesNotMatch(text, /else if\(\(bits&\d+u\)!=0u\)\{return true;\}/)
  assert.match(text, /alpha\*=maskAlpha\(stTable\[at\+\d+u\],uv,/)
})

test('the triangles of an HLOD actor are tested with the actor’s own material words, by the rank its record names', () => {
  const text = wgslProgram('', [sceneTraceWgsl(0, 0), sceneMaskWgsl(0, 0)])
  assert.match(
    text,
    /fn stMaskWord\(placement:u32,record:u32,flags:u32\)->u32\{\s*if\(\(flags&ST_IS_ACTOR\)==0u\)\{return stParams\.materialWord\+placement\*ST_MATERIAL_WORDS;\}\s*let rank=stTable\[record\*ST_RECORD_WORDS\+ST_RECORD_PRIMITIVE\];\s*return select\(stParams\.actorWord\+rank\*ST_MATERIAL_WORDS,NO_INDEX,rank==NO_INDEX\);/,
  )
  assert.match(
    text,
    /let at=stMaskWord\(placement,record,flags\);\s*if\(at==NO_INDEX\)\{return true;\}/,
  )
  assert.equal(
    text.match(/ST_RECORD_FLAGS\]/g)?.length,
    3,
    'the record’s flags are read once by the test, not by each helper',
  )
})

test('the programs the rays cut by are sorted by key, whatever order they joined the session in', () => {
  const programs = (order: number[]) => {
    const graphs = [0.5, 1, 2].map((rate) => {
      const graph = material.graph('surface')
      graph.output('baseColor', graph.constant(1, 0, 0))
      graph.output('opacityMask', graph.sine(graph.time(), rate))
      return { graph }
    })
    return sceneMaskProgramsOf(graphRastersOf(order.map((k) => graphs[k]!)))
  }
  const [forward, backward] = [programs([0, 1, 2]), programs([2, 1, 0])]
  assert.equal(forward.length, 3)
  assert.equal(sceneMaskKey(forward), sceneMaskKey(backward))
  assert.deepEqual(
    forward.map((program) => program.key),
    [...forward.map((program) => program.key)].sort(),
  )
})

test('the masked surface is decided once per instance: an opaque instance never runs the any-hit test per triangle', () => {
  const text = wgslProgram('', [sceneTraceWgsl(0, 0), sceneMaskWgsl(0, 0)])
  assert.match(text, /if\(inst\.masked&&\(stRay\.flags&ST_FORCE_OPAQUE\)==0u&&!stMaskKeeps\(/)
  assert.equal(text.match(/fn stMasked\(/g)?.length, 1)
  assert.match(text, /fn stMasked[^{]*\{\s*let at=stMaskWord\(/)
  assert.match(
    wgslProgram('', [sceneTraceWgsl(0, 0)]),
    /fn stMasked\([^)]*\)->bool\{return false;\}/,
  )
})

test('a set that returns to the content of one still held is that very set, not the last one made', () => {
  const cutting = (rate: number) => {
    const graph = material.graph('surface')
    graph.output('baseColor', graph.constant(1, 0, 0))
    graph.output('opacityMask', graph.sine(graph.time(), rate))
    return { graph }
  }
  const [a, b] = [cutting(3), cutting(5)]
  const held = sceneMaskProgramsOf(graphRastersOf([a]))
  const joined = sceneMaskProgramsOf(graphRastersOf([a, b]))
  assert.notEqual(joined, held)
  assert.equal(sceneMaskProgramsOf(graphRastersOf([a])), held, 'back to the first content')
})
