import test from 'node:test'
import assert from 'node:assert/strict'
import { DISTANCE_FIELD_BRICK } from '../contracts/distanceFieldAbi.ts'
import { buildDistanceField, buildDistanceFieldOnGpu } from './distanceFieldCpu.fixture.ts'
import { distanceFieldDirections } from './distanceFieldSamples.ts'
import type { MeshDistanceField } from './distanceFieldFile.ts'
import { prepareField, voxelJobOf, type VoxelJob, type VoxelKernel } from './distanceFieldGpu.ts'
import { cellOf, frameOf, gridOf, reached, volumeOf } from './distanceFieldGrid.ts'
import { sceneOf, signedDistance } from './distanceFieldScene.ts'
import {
  DISTANCE_FIELD_KERNEL_DOUBT,
  DISTANCE_FIELD_KERNEL_DOUBTFUL,
  DISTANCE_FIELD_KERNEL_ECHO_SHIFT,
  DISTANCE_FIELD_KERNEL_NONE,
} from './distanceFieldKernel.ts'

const f = Math.fround
const BRICK_VOXELS = DISTANCE_FIELD_BRICK ** 3

/** A sphere of radius `r` metres about the origin, `slices` × `stacks`, wound outward: no voxel of the grid lies on its edges, where the sign
 *  of a voxel is a tie the kernel marks doubtful. */
function sphere(r: number, slices = 24, stacks = 12) {
  const positions: number[] = []
  for (let i = 0; i <= stacks; i++)
    for (let j = 0; j <= slices; j++) {
      const phi = (Math.PI * i) / stacks,
        theta = (2 * Math.PI * j) / slices
      positions.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta),
      )
    }
  const indices: number[] = []
  for (let i = 0; i < stacks; i++)
    for (let j = 0; j < slices; j++) {
      const a = i * (slices + 1) + j,
        b = a + slices + 1
      indices.push(a, a + 1, b, a + 1, b + 1, b)
    }
  return { positions, indices }
}

/** The scene, grid and rays a build of `mesh` starts from, as `buildDistanceField` makes them. */
function planOf(mesh: { positions: number[]; indices: number[] }, doubleSided = false) {
  const scene = sceneOf(mesh.positions, mesh.indices, doubleSided, false)!
  const grid = gridOf(
    scene.low,
    scene.high,
    {
      distanceFieldScale: 1,
      distanceFieldTwoSided: false,
      distanceFieldDensity: 0.4,
      distanceFieldMaxResolution: 128,
    },
    scene.mostlyTwoSided,
  )
  const directions = Float64Array.from(distanceFieldDirections().flat())
  const touched = grid.mips.flatMap((mip, index) =>
    Array.from({ length: mip.bricks[0] * mip.bricks[1] * mip.bricks[2] }, (_, rank) => ({
      mip: index,
      rank,
    })).filter(({ rank }) => reached(scene, mip, frameOf(mip, cellOf(rank, mip.bricks)))),
  )
  return { scene, grid, directions, touched }
}

/** A kernel that measures as the device does, from the points it is sent: the distance in double precision at the point rounded to
 *  single, the echo of the point; `spoil` may drop or mislabel a voxel. */
function stubKernel(
  mesh: { positions: number[]; indices: number[] },
  spoil: (at: number, value: [number, number]) => [number, number] = (_, value) => value,
  doubleSided = false,
): VoxelKernel {
  const { scene, grid, directions } = planOf(mesh, doubleSided)
  const origin = [0, 1, 2].map((k) => 0.5 * (scene.low[k] + scene.high[k]))
  const volumes = grid.mips.map((mip) => Float64Array.from(volumeOf(mip).flat()))
  return async (job: VoxelJob, land) => {
    const run = 700
    for (let first = 0; first < job.count; first += run) {
      const count = Math.min(run, job.count - first)
      const items = new Float32Array(4 * count)
      job.fill(first, count, items)
      const results = new Uint32Array(2 * count)
      const view = new Float32Array(results.buffer)
      for (let k = 0; k < count; k++) {
        const mip = items[4 * k + 3]
        const p = [0, 1, 2].map((a) => items[4 * k + a] + origin[a]) as [number, number, number]
        const distance = signedDistance(
          scene,
          p,
          grid.mips[mip].traceDistance,
          directions,
          volumes[mip],
        )
        view[2 * k] = distance
        results[2 * k + 1] = (job.echoOf(first + k) << DISTANCE_FIELD_KERNEL_ECHO_SHIFT) >>> 0
        const [d, s] = spoil(first + k, [results[2 * k], results[2 * k + 1]])
        results[2 * k] = d
        results[2 * k + 1] = s
      }
      land(first, results)
      await Promise.resolve()
    }
  }
}

const BALL = sphere(0.5)
const bytes = (field: MeshDistanceField | undefined) =>
  field?.mips.map((mip) => [Array.from(mip.indirection), Array.from(mip.bricks)])

test('the scene words hold the tree, the triangles about the box centre, the rays and the volumes the kernel reads', () => {
  const { scene, grid, directions, touched } = planOf(BALL)
  const job = voxelJobOf(prepareField(scene, grid.mips, directions, touched))
  const w = job.words
  const floats = new Float32Array(w.buffer)
  const nodesAt = 4 * w[0]
  const trianglesAt = 4 * w[1]
  const nodes = w[2]
  assert.equal(nodes, scene.tree.left.length)
  assert.equal(w[3], Math.floor(0.25 * 98) + 1, 'the fewest back faces that make a voxel inside')
  assert.equal(w[4], 98)
  const origin = [0, 1, 2].map((k) => 0.5 * (scene.low[k] + scene.high[k]))
  // The rays follow the mips' volumes, each a direction as a single-precision float.
  for (let ray = 0; ray < 98; ray++)
    for (let a = 0; a < 3; a++)
      assert.equal(floats[4 * w[5] + 4 * ray + a], f(directions[3 * ray + a]))
  grid.mips.forEach((mip, k) => {
    const at = 4 * w[6] + 8 * k
    assert.equal(floats[at + 3], f(mip.traceDistance))
    const [low, high] = volumeOf(mip)
    for (let a = 0; a < 3; a++) {
      assert.equal(floats[at + a], f(low[a] - origin[a]))
      assert.equal(floats[at + 4 + a], f(high[a] - origin[a]))
    }
  })
  // The triangles in leaf order about the centre; one-sided here, the flag of the first corner 0.
  const slots = scene.tree.triangles.length / 9
  for (let slot = 0; slot < slots; slot++)
    for (let c = 0; c < 3; c++)
      for (let a = 0; a < 3; a++) {
        assert.equal(
          floats[trianglesAt + 12 * slot + 4 * c + a],
          f(scene.tree.triangles[9 * slot + 3 * c + a] - origin[a]),
        )
        assert.equal(w[trianglesAt + 12 * slot + 4 * c + 3], 0)
      }
  // Every node's box holds the corners of the triangles below it, and a leaf names its slots, a node its children.
  const below = (node: number): number[] =>
    scene.tree.left[node] < 0
      ? Array.from({ length: scene.tree.size[node] }, (_, k) => scene.tree.first[node] + k)
      : [...below(scene.tree.left[node]), ...below(scene.tree.right[node])]
  for (let node = 0; node < nodes; node++) {
    const at = nodesAt + 16 * node
    for (const slot of below(node))
      for (let c = 0; c < 3; c++)
        for (let a = 0; a < 3; a++) {
          const corner = floats[trianglesAt + 12 * slot + 4 * c + a]
          assert.ok(
            floats[at + a] < corner && corner < floats[at + 4 + a],
            'the box is widened past its corners',
          )
        }
    if (scene.tree.left[node] < 0) {
      assert.deepEqual(
        Array.from(w.subarray(at + 8, at + 12)),
        Array(4).fill(DISTANCE_FIELD_KERNEL_NONE),
      )
      assert.deepEqual(Array.from(w.subarray(at + 12, at + 14)), [
        scene.tree.first[node],
        scene.tree.size[node],
      ])
    } else {
      assert.deepEqual(Array.from(w.subarray(at + 8, at + 12)), [
        scene.tree.left[node],
        scene.tree.right[node],
        DISTANCE_FIELD_KERNEL_NONE,
        DISTANCE_FIELD_KERNEL_NONE,
      ])
    }
  }
  const largest = Math.max(
    ...Array.from({ length: slots * 12 }, (_, k) =>
      k % 4 === 3 ? 0 : Math.abs(floats[trianglesAt + k]),
    ),
    ...grid.mips.flatMap((mip) =>
      volumeOf(mip).flatMap((corner) => corner.map((v, a) => Math.abs(f(v - origin[a])))),
    ),
  )
  assert.equal(
    floats[7],
    f(DISTANCE_FIELD_KERNEL_DOUBT * largest),
    'the doubt, a share of the largest coordinate',
  )
})

test('a double-sided mesh marks the first corner of every triangle two-sided', () => {
  const { scene, grid, directions, touched } = planOf(BALL, true)
  const { words } = voxelJobOf(prepareField(scene, grid.mips, directions, touched))
  const trianglesAt = 4 * words[1]
  for (let slot = 0; slot < scene.tree.triangles.length / 9; slot++)
    assert.deepEqual(
      [0, 1, 2].map((c) => words[trianglesAt + 12 * slot + 4 * c + 3]),
      [1, 0, 0],
    )
})

test('the points sent are the voxels of the touched bricks, the mip in the fourth float', () => {
  const { scene, grid, directions, touched } = planOf(BALL)
  const job = voxelJobOf(prepareField(scene, grid.mips, directions, touched))
  assert.equal(job.count, touched.length * BRICK_VOXELS)
  const items = new Float32Array(4 * 3)
  const last = job.count - 2
  job.fill(last - 1, 3, items)
  assert.equal(items[3], touched[touched.length - 1].mip)
  assert.equal(job.mipOf(last), touched[touched.length - 1].mip)
  // A run that starts mid-brick reads the same points as the run that holds it whole.
  const whole = new Float32Array(4 * job.count)
  job.fill(0, job.count, whole)
  assert.deepEqual(Array.from(items), Array.from(whole.subarray(4 * (last - 1), 4 * (last + 2))))
})

test('voxels measured by a kernel give the field the CPU gives, byte for byte', async () => {
  const cpu = buildDistanceField(7, BALL.positions, BALL.indices, {
    settings: { distanceFieldDensity: 0.4 },
  })
  const gpu = await buildDistanceFieldOnGpu(stubKernel(BALL), 7, BALL.positions, BALL.indices, {
    settings: { distanceFieldDensity: 0.4 },
  })
  assert.ok(cpu && gpu)
  assert.deepEqual(bytes(gpu), bytes(cpu))
  assert.deepEqual(gpu.min, cpu.min)
  assert.deepEqual(gpu.max, cpu.max)
})

test('a voxel the device dropped, marked doubtful or measured at another point is measured again, whatever it wrote', async () => {
  const settings = { distanceFieldDensity: 0.4 }
  const cpu = buildDistanceField(1, BALL.positions, BALL.indices, { settings })
  const spoiled = stubKernel(BALL, (at, value) => {
    if (at % 7 === 0) return [0xffffffff, 0xffffffff] // dropped: still all ones
    if (at % 7 === 1) return [value[0], (value[1] | DISTANCE_FIELD_KERNEL_DOUBTFUL) >>> 0] // marked doubtful
    if (at % 7 === 2) return [value[0], (value[1] ^ (1 << DISTANCE_FIELD_KERNEL_ECHO_SHIFT)) >>> 0] // another point's echo
    if (at % 7 === 3) return [0x7fc00000, value[1]] // no number
    return value
  })
  const gpu = await buildDistanceFieldOnGpu(spoiled, 1, BALL.positions, BALL.indices, { settings })
  assert.deepEqual(bytes(gpu), bytes(cpu))
})

test('a kernel that fails fails the build, and a mesh with no triangle has no field', async () => {
  const refuse: VoxelKernel = () => Promise.reject(new Error('device lost'))
  await assert.rejects(
    buildDistanceFieldOnGpu(refuse, 0, BALL.positions, BALL.indices),
    /device lost/,
  )
  assert.equal(await buildDistanceFieldOnGpu(refuse, 0, [], []), undefined)
})

/** A disc of radius `r` metres in the plane y = 0, `slices` triangles about its centre: a surface open on both sides, with no inside. */
function disc(r: number, slices = 16) {
  const positions = [0, 0, 0]
  for (let j = 0; j < slices; j++)
    positions.push(
      r * Math.cos((2 * Math.PI * j) / slices),
      0,
      r * Math.sin((2 * Math.PI * j) / slices),
    )
  const indices: number[] = []
  for (let j = 0; j < slices; j++) indices.push(0, 1 + ((j + 1) % slices), 1 + j)
  return { positions, indices }
}

test('an open disc is signed inside on its back side when one-sided, and has no inside when double-sided, on the CPU and through the kernel alike', async () => {
  const mesh = disc(0.45)
  const settings = { distanceFieldDensity: 0.4 }
  // The farthest inside is byte 0: a voxel inside is under the middle, 127.5, past the byte that holds the surface.
  const inside = (field: MeshDistanceField | undefined) =>
    field!.mips.some((mip) => mip.bricks.some((byte) => byte < 126))
  const one = buildDistanceField(1, mesh.positions, mesh.indices, { settings })
  const two = buildDistanceField(1, mesh.positions, mesh.indices, { settings, doubleSided: true })
  assert.equal(inside(one), true, 'one-sided: the side the winding turns from is inside')
  assert.equal(inside(two), false, 'double-sided: a hit on a back face says nothing of the inside')
  for (const doubleSided of [false, true]) {
    const options = { settings, doubleSided }
    const gpu = await buildDistanceFieldOnGpu(
      stubKernel(mesh, undefined, doubleSided),
      1,
      mesh.positions,
      mesh.indices,
      options,
    )
    assert.deepEqual(
      bytes(gpu),
      bytes(doubleSided ? two : one),
      `through the kernel, double-sided ${doubleSided}`,
    )
  }
})
