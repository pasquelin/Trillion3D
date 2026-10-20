import test from 'node:test'
import assert from 'node:assert/strict'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts'
import { createWorldCuts } from './worldCuts.ts'
import { WaterSurface } from '../../../../sdk-core/src/fluids/waterSurface.ts'
import '../../wasm/sdkWasm.fixture.ts'

// A cut encodes its pages, and measures their cones, in the SDK module (`runtimeCut.ts`), which
// the fixture instantiates from the bytes the repository ships.

// A line worn by a dashed material is read with its distance along the line; the same line
// worn solid is read without it, into a resource of its own.
test('a dashed line is read with its distance along the line, a solid one without', async () => {
  const cuts = createWorldCuts()
  const path = geometry.createBuffer({
    position: new BufferAttribute(new Float32Array([0, 0, 0, 4, 0, 0]), 3),
  })
  const dashed = await cuts.of(object.line(path, material.lineDashed({ dashSize: 0.3 })))
  const solid = await cuts.of(object.line(path, material.line()))
  assert.deepEqual(Array.from(dashed!.drawn.uvs!), [0, 0, 0, 0, 4, 0, 4, 0])
  assert.equal(solid!.drawn.uvs, null)
  assert.notEqual(dashed!.key, solid!.key)
  cuts.dispose()
})

// A blended surface draws from its pages what it drew from its floats. Its pages take the
// finest grids a page holds (2^23 steps across the widest span); an opaque wearer of the same
// geometry keeps the grids its image was proved on, in a resource of its own.
test('a blended wearer is cut on the finest page grid, an opaque one keeps its grid', async () => {
  const cuts = createWorldCuts()
  const sphere = geometry.sphere(1, 16, 12)
  const opaque = await cuts.of(object.mesh(sphere, material.meshStandard()))
  const blended = await cuts.of(
    object.mesh(sphere, material.meshStandard({ transparent: true, opacity: 0.5 })),
  )
  assert.notEqual(opaque!.key, blended!.key)
  const grid = (cut: typeof opaque) => cut!.runtime.primitive.quantization!
  assert.equal(grid(opaque).positionExponent, 1 - 16)
  assert.equal(grid(blended).positionExponent, 1 - 23)
  assert.ok(grid(blended).maxPositionError! <= 2 ** -22)
  assert.ok(grid(opaque).maxPositionError! > grid(blended).maxPositionError!)
  // Its texture coordinates too, a unit wide: 2^-23 where the format keeps 2^-14.
  assert.equal(grid(opaque).uvExponent, -14)
  assert.equal(grid(blended).uvExponent, -23)
  // Added light blends whatever `transparent` says: the same finest grids.
  const added = await cuts.of(object.mesh(sphere, material.meshBasic({ blending: 'additive' })))
  assert.equal(grid(added).positionExponent, 1 - 23)
  cuts.dispose()
})

// A sheet the waves carry moves after its cut, as a rewritten one does: blended, it is cut held to
// its paint order in as few runs as the caps allow, each cut where the order jumps
// (`page-codec-wasm/src/clusters.rs`), and keeps no cone — a shadow raster draws each into the
// pages it reaches; the same sheet at rest keeps the format's clusters and their cones.
test('a sheet the waves carry is cut held, in runs without cones; at rest, in the format clusters', async () => {
  const cuts = createWorldCuts()
  const sheet = geometry.plane(28, 20, 112, 80)
  const water = () => material.meshStandard({ transparent: true, opacity: 0.8 })
  const resting = await cuts.of(object.mesh(sheet, water()))
  const sea = object.mesh(sheet, water())
  sea.waves = new WaterSurface({
    level: 0,
    waves: [{ direction: [1, 0], wavelength: 6, amplitude: 0.3, steepness: 0.3 }],
  })
  const carried = await cuts.of(sea)
  assert.notEqual(carried!.key, resting!.key)
  const pages = (cut: typeof resting) => cut!.runtime.primitive.pages
  assert.equal(pages(resting).length, 140, '17 920 triangles, 128 a cluster')
  assert.equal(pages(carried).length, 140, 'as few runs as the caps allow')
  assert.ok(
    pages(resting).some((page) => page.cone),
    'a resting face keeps its cone',
  )
  assert.ok(
    pages(carried).every((page) => !page.cone),
    'a moving face keeps no cone',
  )
  cuts.dispose()
})
