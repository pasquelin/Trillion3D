// The closure tree of a material graph: its operators, the closures it flattens to under the project's
// limit, what compiles for them, and the one-closure graph left as it was.
import test from 'node:test'
import assert from 'node:assert/strict'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { MaterialGraph } from '../../../../sdk-core/src/world/material/graph/api.ts'
import { flattenClosures } from '../../../../sdk-core/src/world/material/graph/closureFlatten.ts'
import { CLOSURES_MAX, CLOSURE_RULES } from '../../../../sdk-core/src/contracts/closureOptions.ts'
import { COLOR_SAMPLE_WGSL } from '../virtual/wgsl.ts'
import { compileGraph } from './compile.ts'
import { programOf } from './surfaceProgram.ts'
import { clampClosureLimit } from '../closures/closureLimit.ts'
import {
  MAX_CLOSURES,
  wiresOutput,
} from '../../../../sdk-core/src/world/material/graph/closures.ts'
import { closureCountOf, effectiveMaxClosures } from '../closures/viewClosures.ts'

const options = { sample: COLOR_SAMPLE_WGSL, derivatives: 'neighbours' } as const
type Graph = MaterialGraph
const slabOf = (g: Graph, r: number) =>
  g.slab({ baseColor: g.constant(r, 0, 0), roughness: g.constant(r / 10) })

test('each operator flattens to its closures with the terms that weigh them', () => {
  const g = material.graph('surface')
  const a = slabOf(g, 1),
    b = slabOf(g, 2),
    c = slabOf(g, 3)
  const mixed = g.horizontalMix(a, b, 0.25)
  const root = g.weightClosure(g.addClosures(mixed, c), 0.5)
  const { closures, operators } = flattenClosures(g.closureNodes, root, 8)
  assert.equal(closures.length, 3)
  assert.equal(operators, 6)
  assert.deepEqual(
    closures.map((x) => x.members[0].slab),
    [a, b, c],
  )
  assert.deepEqual(
    closures[0].terms.map((t) => t.kind),
    ['weight', 'unmix'],
  )
  assert.deepEqual(
    closures[1].terms.map((t) => t.kind),
    ['weight', 'mix'],
  )
  assert.deepEqual(
    closures[2].terms.map((t) => t.kind),
    ['weight'],
  )
})

test('a vertical layering lists the closures above each closure of its base', () => {
  const g = material.graph('surface')
  const top = slabOf(g, 1),
    base = slabOf(g, 2)
  const { closures } = flattenClosures(g.closureNodes, g.verticalLayer(top, base), 8)
  assert.deepEqual(
    closures.map((x) => x.layers),
    [[], [{ tops: [0], outside: 0 }]],
  )
})

test('a tree of more closures than the limit is blended, the deepest operator first', () => {
  const g = material.graph('surface')
  const [a, b, c, d] = [1, 2, 3, 4].map((r) => slabOf(g, r))
  const lower = g.horizontalMix(c, d)
  const root = g.verticalLayer(g.horizontalMix(a, b), lower)
  assert.equal(flattenClosures(g.closureNodes, root, 4).closures.length, 4)
  const three = flattenClosures(g.closureNodes, root, 3)
  assert.deepEqual(
    three.closures.map((x) => x.members.map((m) => m.slab)),
    [[a], [b], [c, d]],
  )
  assert.equal(flattenClosures(g.closureNodes, root, 1).closures.length, 1)
  assert.equal(flattenClosures(g.closureNodes, root, 1).closures[0].members.length, 4)
})

test('a node asked to blend is one closure, and the operator count is bounded', () => {
  const g = material.graph('surface')
  const a = slabOf(g, 1),
    b = slabOf(g, 2)
  assert.equal(flattenClosures(g.closureNodes, g.addClosures(a, b, true), 8).closures.length, 1)
  // A tree that fits the limit is not simplified further: sixteen weights over a slab are seventeen operators.
  let root = slabOf(g, 0)
  for (let i = 0; i < 16; i++) root = g.weightClosure(root, 0.9)
  assert.throws(() => g.closures(root), /operators/)
})

test('a graph refuses a closure that does not exist and an output a closure does not own', () => {
  const g = material.graph('surface')
  assert.throws(() => g.weightClosure(3, 0.5), /does not exist/)
  assert.throws(
    () => g.slab({ opacityMask: g.constant(1) } as never),
    /not an output a closure owns/,
  )
})

test('the tree saves, loads, clones and changes the signature', () => {
  const g = material.graph('surface')
  const before = g.signature()
  const root = g.horizontalMix(slabOf(g, 1), slabOf(g, 2), g.constant(0.3))
  g.closures(root)
  assert.notEqual(g.signature(), before)
  for (const copy of [MaterialGraph.fromJSON(g.toJSON()), g.clone()]) {
    assert.equal(copy.signature(), g.signature())
    assert.equal(copy.closureRoot, root)
  }
})

test("the slabs compile: the primary as the graph's outputs, the others by rank, the wired scalars by wire", () => {
  const g = material.graph('surface')
  const root = g.horizontalMix(slabOf(g, 1), slabOf(g, 2), g.scalarParameter('mix', 0.5))
  g.closures(root)
  const compiled = compileGraph(g, options)
  assert.equal(compiled.closures?.flat.closures.length, 2)
  assert.ok(compiled.functions.baseColor && compiled.functions.roughness)
  const second = compiled.closures!.slabs.get(1)!
  assert.match(second.baseColor!, /^mgBaseColorS1$/)
  assert.equal(compiled.closures!.operands.size, 1)
  assert.ok(compiled.outputs.some((o) => o.name === 'closureOperand'))
  assert.equal(closureCountOf(compiled), 2)
  assert.equal(closureCountOf(compileGraph(g, { ...options, closureLimit: 1 })), 1)
  g.output('baseColor', g.constant(1, 1, 1))
  assert.throws(() => compileGraph(g, options), /wired on its slabs/)
})

test('a graph of one closure compiles as it did: no closures, the text of the outputs alone', () => {
  const g = material.graph('surface')
  g.output('baseColor', g.constant(1, 0, 0))
  g.output('roughness', g.constant(0.3))
  const compiled = compileGraph(g, options)
  assert.equal(compiled.closures, undefined)
  assert.equal(closureCountOf(compiled), 1)
  assert.deepEqual(Object.keys(compiled.functions).sort(), ['baseColor', 'roughness'])
  assert.ok(!compiled.key.includes('['))
  // The same surface as the primary slab of a tree is the same functions.
  const t = material.graph('surface')
  t.closures(t.slab({ baseColor: t.constant(1, 0, 0), roughness: t.constant(0.3) }))
  const treed = compileGraph(t, options)
  assert.equal(treed.closures?.flat.closures.length, 1)
  assert.deepEqual(
    treed.outputs.map((o) => o.body),
    compiled.outputs.map((o) => o.body),
  )
})

test("the views keep the most closures any material in view has, within the project's", () => {
  assert.equal(CLOSURE_RULES.closuresPerPixel.default, 4)
  assert.equal(CLOSURES_MAX, MAX_CLOSURES, 'the contract and the format hold the same bound')
  assert.equal(effectiveMaxClosures(true, 6, 4), 4)
  assert.equal(effectiveMaxClosures(true, 2, 4), 2)
  assert.equal(effectiveMaxClosures(false, 2, 4), 4)
  assert.equal(effectiveMaxClosures(true, 9, 12), 8, 'a ninth closure keeps eight, not one')
})

test('the limit is held between one and the format most, a non-number being the default', () => {
  assert.deepEqual(
    [0, -3, 1, 4.7, 8, 12, NaN, undefined].map(clampClosureLimit),
    [1, 1, 1, 4, 8, 8, 4, 4],
  )
  const g = material.graph('surface')
  const root = g.addClosures(g.addClosures(slabOf(g, 1), slabOf(g, 2)), slabOf(g, 3))
  g.closures(root)
  for (const [asked, kept] of [
    [NaN, 3],
    [12, 3],
    [0, 1],
    [3.9, 3],
  ] as const)
    assert.equal(closureCountOf(compileGraph(g, { ...options, closureLimit: asked })), kept)
})

test("the project's limit compiles every surface program of a tree, another limit another program", () => {
  const g = material.graph('surface')
  g.closures(g.addClosures(g.addClosures(slabOf(g, 1), slabOf(g, 2)), slabOf(g, 3)))
  const plain = material.graph('surface')
  plain.output('baseColor', plain.constant(1, 0, 0))
  const four = programOf({ graph: g }, undefined, 4)
  const plainFour = programOf({ graph: plain }, undefined, 4)
  assert.ok('compiled' in four! && closureCountOf(four.compiled) === 3)
  const two = programOf({ graph: g }, undefined, 1)
  assert.ok('compiled' in two! && closureCountOf(two.compiled) === 1)
  assert.notEqual(two.compiled.key, four.compiled.key)
  // A graph without a tree is the same program whatever the limit.
  assert.equal(programOf({ graph: plain }, undefined, 1), plainFour)
})

test('a closure root that does not exist, and nodes restored badly, are refused as an invalid material', () => {
  const g = material.graph('surface')
  slabOf(g, 1)
  for (const root of [7, -1, 0.5, undefined as unknown as number])
    assert.throws(() => g.closures(root), { code: 'INVALID_MATERIAL' })
  const saved = (nodes: unknown[]) => ({ ...g.toJSON(), closures: { nodes, root: 0 } }) as never
  const slab = { id: 0, kind: 'slab', attributes: {} }
  for (const bad of [
    { id: 0, kind: 'nope' },
    { id: 0, kind: 'slab' },
    { id: 0, kind: 'slab', attributes: { baseColor: 5 } },
    { id: 0, kind: 'slab', attributes: { baseColor: { node: 99, output: 0 } } },
    { id: 0, kind: 'weight', input: 0, weight: 0.5 },
    null,
  ])
    assert.throws(() => MaterialGraph.fromJSON(saved([bad])), { code: 'INVALID_MATERIAL' })
  assert.throws(
    () => MaterialGraph.fromJSON(saved([slab, { id: 1, kind: 'weight', input: 0, weight: 'x' }])),
    { code: 'INVALID_MATERIAL' },
  )
  assert.throws(
    () => MaterialGraph.fromJSON(saved([slab, { id: 1, kind: 'add', a: 0, b: 0, blend: 1 }])),
    { code: 'INVALID_MATERIAL' },
  )
  assert.ok(MaterialGraph.fromJSON(saved([slab])))
})

test('a closure node reached twice from the root is refused, as the reference registers one expression once', () => {
  const g = material.graph('surface')
  const a = slabOf(g, 1)
  assert.throws(() => g.closures(g.addClosures(a, a)), /more than once/)
  const mixed = g.horizontalMix(a, slabOf(g, 2))
  assert.throws(() => g.closures(g.verticalLayer(mixed, mixed)), /more than once/)
  // The same slab under two different trees is fine: only a tree is walked.
  g.closures(mixed)
  assert.equal(g.closureRoot, mixed)
})

test('a scalar operand is compiled for itself, one function a wire, whatever the operators that read it', () => {
  const g = material.graph('surface')
  const mix = g.scalarParameter('mix', 0.5)
  const [a, b, c] = [1, 2, 3].map((r) => slabOf(g, r))
  g.closures(g.horizontalMix(g.horizontalMix(a, b, mix), c, mix))
  const compiled = compileGraph(g, options)
  assert.equal(compiled.closures!.operands.size, 1)
  assert.equal(compiled.outputs.filter((o) => o.name === 'closureOperand').length, 1)
  assert.ok(compiled.wgsl.text.includes('fn mgClosureOperand'))
})

test('a lobe any slab of the tree wires counts for the surface', () => {
  const g = material.graph('surface')
  const primary = slabOf(g, 1)
  const coated = g.slab({ baseColor: g.constant(0, 1, 0), clearCoat: g.constant(1) })
  g.closures(g.verticalLayer(primary, coated))
  assert.equal(wiresOutput(g, 'clearCoat'), true)
  assert.equal(wiresOutput(g, 'anisotropy'), false)
  assert.equal(wiresOutput(g, 'baseColor'), true)
  const alone = material.graph('surface')
  alone.output('cloth', alone.constant(1))
  assert.equal(wiresOutput(alone, 'cloth'), true)
})

test('a closure node used from two places is refused when the root is set, and a base keeps its own coverage', () => {
  const g = material.graph('surface')
  const shared = slabOf(g, 1)
  assert.throws(
    () => g.closures(g.addClosures(shared, g.weightClosure(shared, 0.5))),
    /more than once/,
  )
  const [top, base] = [slabOf(g, 2), slabOf(g, 3)]
  const { closures } = flattenClosures(g.closureNodes, g.verticalLayer(top, base), 8)
  assert.deepEqual(
    closures.map((c) => c.terms),
    [[], []],
  )
  assert.deepEqual(
    closures[1].layers,
    [{ tops: [0], outside: 0 }],
    'the evaluation reads the top the base sits under',
  )
})
