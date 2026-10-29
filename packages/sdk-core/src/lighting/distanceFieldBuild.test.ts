import test from 'node:test'
import assert from 'node:assert/strict'
import { DISTANCE_FIELD_BRICK, DISTANCE_FIELD_UNIQUE_BRICK } from '../contracts/distanceFieldAbi.ts'
import { buildDistanceField } from './distanceFieldCpu.fixture.ts'
import { distanceFieldDirections } from './distanceFieldSamples.ts'
import type { MeshDistanceField } from './distanceFieldFile.ts'

const UNIQUE = DISTANCE_FIELD_UNIQUE_BRICK
const BRICK = DISTANCE_FIELD_BRICK

/** A cube of side `side` metres about the origin: eight corners, twelve triangles wound outward. */
function cube(side = 1) {
  const h = side / 2
  const positions: number[] = []
  for (let k = 0; k < 8; k++) positions.push(k & 1 ? h : -h, k & 2 ? h : -h, k & 4 ? h : -h)
  // Corner bit k set at the high end of axis k; each face's two triangles are wound counter-clockwise seen from outside.
  const faces = [
    [0, 4, 6, 2],
    [1, 3, 7, 5],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 2, 3, 1],
    [4, 5, 7, 6],
  ]
  const indices = faces.flatMap(([a, b, c, d]) => [a, b, c, a, c, d])
  return { positions, indices }
}

/** A sphere of radius `r` metres about the origin, `slices` × `stacks`, wound outward. */
function sphere(r: number, slices = 32, stacks = 16) {
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

/** The voxels `mip` of `field` stores, each as its position (centimetres) and the signed distance (centimetres) its byte holds. */
function voxelsOf(field: MeshDistanceField, mipRank = 0) {
  const mip = field.mips[mipRank]
  const [x, y, z] = mip.indirectionSize
  const centre = field.min.map((l, k) => 50 * (l + field.max[k])) // metres to centimetres, halved
  const halfMax = Math.max(...field.min.map((l, k) => 50 * (field.max[k] - l)))
  const toVolume = 1 / halfMax
  const voxels: { at: number[]; distance: number }[] = []
  const total = mip.indirectionSize.map((b) => b * UNIQUE)
  for (let cell = 0; cell < x * y * z; cell++) {
    const brick = mip.indirection[cell]
    if (brick === 0xffffffff) continue
    const at = [cell % x, Math.floor(cell / x) % y, Math.floor(cell / (x * y))]
    for (let i = 0; i < BRICK ** 3; i++) {
      const local = [i % BRICK, Math.floor(i / BRICK) % BRICK, Math.floor(i / BRICK ** 2)]
      // The voxel `g` of the volume lies at `g / voxels` of the virtual texture, a border voxel before the box (the box's low corner at `1 / voxels`).
      const g = local.map((l, k) => at[k] * UNIQUE + l)
      const p = g.map((v, k) => {
        const uv = v / total[k]
        return (
          centre[k] + (uv - mip.volumeToVirtualUvAdd[k]) / mip.volumeToVirtualUvScale[k] / toVolume
        )
      })
      const byte = mip.bricks[brick * BRICK ** 3 + i]
      voxels.push({
        at: p,
        distance: ((byte / 255) * mip.distanceScale + mip.distanceBias) / toVolume,
      })
    }
  }
  return { voxels, band: mip.distanceScale / 2 / toVolume }
}

test('the rays of a voxel are 49 samples of a hemisphere and 49 of the other, unit vectors', () => {
  const rays = distanceFieldDirections()
  assert.equal(rays.length, 98)
  for (const [x, y, z] of rays) assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-4)
  assert.ok(rays.slice(0, 49).every(([, , z]) => z >= 0))
  assert.ok(rays.slice(49).every(([, , z]) => z <= 0))
  assert.deepEqual(distanceFieldDirections(), rays, 'a rebuild casts the same rays')
})

test('a cube of a metre: its box, its three mips, bricks along its size, one brick of border', () => {
  const { positions, indices } = cube()
  const field = buildDistanceField(3, positions, indices)!
  assert.equal(field.mesh, 3)
  assert.equal(field.hlodCell, false)
  assert.equal(field.mostlyTwoSided, false)
  assert.deepEqual([...field.min], [-0.5, -0.5, -0.5])
  assert.deepEqual([...field.max], [0.5, 0.5, 0.5])
  // 100 cm × 0.2 voxels × scale 1 over 7: three bricks; each mip half the one before, rounded up.
  assert.deepEqual(
    field.mips.map((m) => [...m.indirectionSize]),
    [
      [3, 3, 3],
      [2, 2, 2],
      [1, 1, 1],
    ],
  )
  for (const mip of field.mips) {
    assert.equal(
      mip.indirection.length,
      mip.indirectionSize.reduce((a, b) => a * b),
    )
    assert.equal(mip.bricks.length, mip.brickCount * BRICK ** 3)
  }
})

test("a cube's voxels hold its distance to the surface, negative inside, positive outside, to a quantisation step", () => {
  const { positions, indices } = cube()
  const field = buildDistanceField(0, positions, indices)!
  const { voxels, band } = voxelsOf(field)
  assert.ok(voxels.length > 0)
  const step = (2 * band) / 255
  let inside = 0,
    outside = 0
  for (const { at, distance } of voxels) {
    // The signed distance to a box of half side 50: positive outside.
    const q = at.map((c) => Math.abs(c) - 50)
    const exact = Math.hypot(...q.map((c) => Math.max(c, 0))) + Math.min(Math.max(...q), 0)
    const held = Math.max(-band, Math.min(band, exact))
    // Past half the band a voxel's rays reach too few faces to say it is inside (they are as long as the band): the compiler's own limit.
    if (exact < -band / 2) continue
    assert.ok(
      Math.abs(distance - held) <= step * 1.01,
      `${at.map((c) => c.toFixed(1))}: ${distance} vs ${held}`,
    )
    if (exact < -step) inside++
    if (exact > step) outside++
  }
  assert.ok(inside > 0 && outside > 0, 'the band holds both sides')
})

test("a sphere's voxels agree in sign and to a centimetre in distance", () => {
  const { positions, indices } = sphere(0.5)
  const field = buildDistanceField(0, positions, indices)!
  const { voxels, band } = voxelsOf(field)
  let signs = 0
  for (const { at, distance } of voxels) {
    const exact = Math.hypot(...at) - 50
    const held = Math.max(-band, Math.min(band, exact))
    if (exact < -band / 2) continue
    if (Math.abs(exact) > 1.5) {
      assert.equal(Math.sign(distance), Math.sign(exact), `${at.map((c) => c.toFixed(1))}`)
      signs++
    }
    assert.ok(Math.abs(distance - held) <= 1.0 + (2 * band) / 255, `${distance} vs ${held}`)
  }
  assert.ok(signs > 100)
})

test('a mesh with no triangle, or whose scale is 0, has no field; a degenerate triangle alone has none', () => {
  assert.equal(buildDistanceField(0, [0, 0, 0], []), undefined)
  const { positions, indices } = cube()
  assert.equal(
    buildDistanceField(0, positions, indices, { settings: { distanceFieldScale: 0 } }),
    undefined,
  )
  assert.equal(buildDistanceField(0, [0, 0, 0, 1, 0, 0, 2, 0, 0], [0, 1, 2]), undefined)
})

test('a double-sided mesh is mostly two-sided: its box grows by a texel and no voxel is inside', () => {
  const { positions, indices } = cube()
  const one = buildDistanceField(0, positions, indices)!
  const two = buildDistanceField(0, positions, indices, { doubleSided: true })!
  assert.equal(two.mostlyTwoSided, true)
  assert.ok(two.max[0] > one.max[0], 'the box is a texel larger')
  assert.ok(voxelsOf(two).voxels.every(({ distance }) => distance >= 0))
})

test('the density sets the bricks, a scale of 2 doubles what the resolution allows, a larger mesh holds more bricks than a smaller', () => {
  const small = buildDistanceField(0, ...(Object.values(cube(1)) as [number[], number[]]))!
  const large = buildDistanceField(0, ...(Object.values(cube(4)) as [number[], number[]]))!
  assert.ok(large.mips[0].indirectionSize[0] > small.mips[0].indirectionSize[0])
  const dense = buildDistanceField(0, ...(Object.values(cube(1)) as [number[], number[]]), {
    settings: { distanceFieldDensity: 0.4 },
  })!
  assert.ok(dense.mips[0].indirectionSize[0] > small.mips[0].indirectionSize[0])
  const huge = buildDistanceField(0, ...(Object.values(cube(20)) as [number[], number[]]))!
  // A box of 2000 cm at the default density holds 57 bricks an axis; the resolution 256 held to its half for a scale of 1 allows 18.
  assert.equal(huge.mips[0].indirectionSize[0], 18)
})
