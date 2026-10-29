import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RAY_TRACING_FLAG_MASKED,
  RAY_TRACING_FLAG_TRANSLUCENT,
  RAY_TRACING_FLAG_TWO_SIDED,
} from '../../../../../sdk-core/src/contracts/rayTracingAbi.ts'
import type { RayTracing } from '../../../../../sdk-core/src/lighting/rayTracingFile.ts'
import { rayTracingTreeOf } from '../../../../../sdk-core/src/lighting/rayTracingTree.ts'
import { rayTracingOf } from './runtimeRays.ts'

const tree = rayTracingTreeOf([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2])!
const surface = (side: string, transparent = false) => ({ side, alphaTest: 0, transparent })
const root = (mesh: number, rayTracing: typeof tree | undefined, worn = surface('front')) => ({
  mesh,
  primitive: 0,
  rayTracing,
  worn: { surface: worn },
})
const scene = (roots: object[], file?: RayTracing) =>
  ({ context: { rayTracing: file }, layout: { selectionRoots: roots } }) as unknown as Parameters<
    typeof rayTracingOf
  >[0]

test('a scene with neither a file nor a run-time tree has no structure', () => {
  assert.equal(rayTracingOf(scene([root(0, undefined)])), undefined)
})

test('a run-time primitive is a record of its mesh, flagged as the material that places it', () => {
  const rt = scene([root(4, tree, surface('double', true))])
  const made = rayTracingOf(rt)!
  assert.equal(made.byPrimitive.get(4)?.get(0), 0)
  assert.ok((made.records[2] & RAY_TRACING_FLAG_TWO_SIDED) !== 0)
  assert.ok((made.records[2] & RAY_TRACING_FLAG_TRANSLUCENT) !== 0)
})

test('the placements of one primitive are one record, and the structure is the same object until the trees change', () => {
  const roots = [root(4, tree), root(4, tree)]
  const rt = scene(roots)
  const made = rayTracingOf(rt)!
  assert.equal(made.records.length, 16)
  assert.equal(rayTracingOf(rt), made)
  roots.push(root(5, rayTracingTreeOf([0, 0, 0, 2, 0, 0, 0, 2, 0], [0, 1, 2])!))
  const grown = rayTracingOf(rt)!
  assert.notEqual(grown, made)
  assert.equal(grown.records.length, 32)
})

test("a material's flag changed is a structure made again, not the one held", () => {
  const worn = surface('front')
  const rt = scene([root(4, tree, worn)])
  const made = rayTracingOf(rt)!
  assert.equal(made.records[2] & RAY_TRACING_FLAG_TWO_SIDED, 0)
  worn.side = 'double'
  const changed = rayTracingOf(rt)!
  assert.notEqual(changed, made)
  assert.ok((changed.records[2] & RAY_TRACING_FLAG_TWO_SIDED) !== 0)
  worn.transparent = true
  assert.ok((rayTracingOf(rt)!.records[2] & RAY_TRACING_FLAG_TRANSLUCENT) !== 0)
  worn.alphaTest = 0.5
  assert.ok((rayTracingOf(rt)!.records[2] & RAY_TRACING_FLAG_MASKED) !== 0)
})

test('a primitive placed by two materials is double-sided and masked where one is, translucent where both are', () => {
  const [a, b] = [surface('front', true), surface('double', true)]
  const flags = (...worn: ReturnType<typeof surface>[]) =>
    rayTracingOf(scene(worn.map((w) => root(4, tree, w))))!.records[2]
  assert.ok((flags(a, b) & RAY_TRACING_FLAG_TWO_SIDED) !== 0)
  assert.ok((flags(a, b) & RAY_TRACING_FLAG_TRANSLUCENT) !== 0)
  assert.equal(flags(a, surface('front')) & RAY_TRACING_FLAG_TRANSLUCENT, 0)
})
