import test from 'node:test'
import assert from 'node:assert/strict'
import { rayTracingTreeOf } from '../../../../../sdk-core/src/lighting/rayTracingTree.ts'
import type { VoxelKernel } from '../../../../../sdk-core/src/lighting/distanceFieldGpu.ts'
import type { TrackedRoot } from '../objectTable.ts'
import {
  finishDistanceField,
  prepareDistanceField,
} from '../../../../../sdk-core/src/lighting/distanceFieldBuild.ts'
import { soupIndices } from '../../../../../sdk-core/src/lighting/rayTracingTree.ts'
import { createRuntimeFields, type RuntimeFieldTasks } from './runtimeFields.ts'

/** A tetrahedron of `size` metres, four triangles wound outward. */
function tetrahedron(size: number) {
  const positions = [0, 0, 0, size, 0, 0, 0, size, 0, 0, 0, size]
  return { positions, indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3] }
}

const root = (rayTracing?: ReturnType<typeof rayTracingTreeOf>): TrackedRoot => ({
  runtime: true,
  rayTracing: rayTracing ?? undefined,
  world: { elements: new Float64Array(16) },
})

/** The two CPU halves run here, as the workers run them; `sides` hears the two-sidedness each was asked for. */
const tasksIn = (sides: boolean[] = []): RuntimeFieldTasks => ({
  plan: async (positions, doubleSided) => {
    sides.push(doubleSided)
    return prepareDistanceField(positions, soupIndices(positions), { doubleSided })
  },
  finish: async (mesh, positions, doubleSided, measured) => {
    sides.push(doubleSided)
    return finishDistanceField(mesh, positions, soupIndices(positions), measured, { doubleSided })
  },
})

/** A kernel that gives every voxel up as dropped, so the CPU measures them all. */
const dropping: VoxelKernel = async (job, land) =>
  land(0, new Uint32Array(2 * job.count).fill(0xffffffff))

/** Lets the queued builds run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

test('a field is built once for a tree, a few turns after it is asked, and the version moves when it is', async () => {
  let kernels = 0
  const fields = createRuntimeFields(() => (kernels++, dropping), tasksIn(), assert.ifError)
  const tree = rayTracingTreeOf(...(Object.values(tetrahedron(1)) as [number[], number[]]))!
  const placed = root(tree)
  assert.equal(fields.fieldOf(placed), undefined, 'none while it is built')
  assert.equal(fields.version, 0)
  await settle()
  assert.equal(fields.version, 1)
  const field = fields.fieldOf(placed)
  assert.ok(field && field.mesh < 0 && !field.hlodCell, 'a number below the compiled meshes’')
  assert.equal(fields.fieldOf(root(tree)), field, 'a second placement of the primitive shares it')
  await settle()
  assert.equal(fields.version, 1, 'built once')
  assert.equal(kernels, 1)
})

test('two trees get two fields with two numbers', async () => {
  const fields = createRuntimeFields(() => dropping, tasksIn(), assert.ifError)
  const [a, b] = [1, 2].map((size) =>
    root(rayTracingTreeOf(...(Object.values(tetrahedron(size)) as [number[], number[]]))!),
  )
  fields.fieldOf(a)
  fields.fieldOf(b)
  await settle()
  assert.notEqual(fields.fieldOf(a)!.mesh, fields.fieldOf(b)!.mesh)
})

test('a mesh with no tree gets none and starts no build', async () => {
  const fields = createRuntimeFields(
    () => () => assert.fail('no kernel runs'),
    tasksIn(),
    assert.ifError,
  )
  assert.equal(fields.fieldOf(root()), undefined)
  await settle()
  assert.equal(fields.version, 0)
})

test('a build that fails is said once and not tried again', async () => {
  const said: unknown[] = []
  const refusing: VoxelKernel = () => Promise.reject(new Error('device lost'))
  const fields = createRuntimeFields(
    () => refusing,
    tasksIn(),
    (error: unknown) => said.push(error),
  )
  const placed = root(rayTracingTreeOf(...(Object.values(tetrahedron(1)) as [number[], number[]]))!)
  fields.fieldOf(placed)
  await settle()
  fields.fieldOf(placed)
  await settle()
  assert.equal(said.length, 1)
  assert.match(String(said[0]), /device lost/)
  assert.equal(fields.fieldOf(placed), undefined)
})

test('disposed, the fields queued are not built', async () => {
  let built = 0
  const counting: VoxelKernel = async (job, land) => {
    built++
    return dropping(job, land)
  }
  const fields = createRuntimeFields(() => counting, tasksIn(), assert.ifError)
  const [a, b] = [1, 2].map((size) =>
    root(rayTracingTreeOf(...(Object.values(tetrahedron(size)) as [number[], number[]]))!),
  )
  fields.fieldOf(a)
  fields.fieldOf(b)
  fields.dispose()
  await settle()
  assert.equal(built, 0)
})

test("the material's two-sidedness reaches both CPU halves of the build", async () => {
  const sides: boolean[] = []
  const fields = createRuntimeFields(() => dropping, tasksIn(sides), assert.ifError)
  const tree = rayTracingTreeOf(...(Object.values(tetrahedron(1)) as [number[], number[]]))!
  fields.fieldOf({ ...root(tree), doubleSided: true })
  await settle()
  assert.deepEqual(sides, [true, true])
  assert.equal(fields.version, 1)
})
