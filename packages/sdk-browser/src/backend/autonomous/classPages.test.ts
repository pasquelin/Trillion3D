// A material moved into or out of blended in the session (#846): the compiler cuts a blended
// primitive on finer grids (#875), so WebGL2 cuts the primitive's pages again from its source
// vertices on the grids of its new class, and draws its own pages again once back.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as G from '../../host/graph/graph.fixture.ts'
import { encodeGeometryPage } from '../../../../page-codec/src/geometryPage.ts'
import { decodeGeometryPage } from '../../page/decode/geometryPage.ts'
import { prepareSdkWasm } from '../../page/decode/geometryPageWasm.ts'
import type { AlphaMode } from '../../../../sdk-core/src/contracts/material.ts'
import { positionGridExponent } from '../../world/page/cutGrid.ts'
import { drawnPageMeshes, triangleBackend } from './triangle.fixture.ts'

// The grids are the compiler's rules, run in the SDK module: Node is handed its bytes.
await prepareSdkWasm(readFileSync(join(import.meta.dirname, '../../page/decode/pageCodec.wasm')))

/** The triangle's source vertices, off both grids: each class rounds them its own way. */
const SOURCE = [-0.3, -0.3, 0, 0.3, -0.3, 0, 0, 0.3, 0]

/** The triangle opened on WebGL2 from a page cut before its source moved to `SOURCE`. */
async function opened(options?: Parameters<typeof triangleBackend>[0]) {
  const triangle = triangleBackend(options)
  await triangle.backend.prepare()
  ;(triangle.geometry.getAttribute('position')!.array as Float32Array).set(SOURCE)
  return triangle
}

/** The positions the display graph draws the page with, one list per mesh drawn. */
const drawnMeshes = (triangle: Awaited<ReturnType<typeof opened>>) =>
  drawnPageMeshes(triangle).map((mesh) => [...mesh.geometry.getAttribute('position')!.array])
const drawnPositions = (triangle: Awaited<ReturnType<typeof opened>>) => drawnMeshes(triangle)[0]

/** The material written to `to`, and the engine told. */
function move(triangle: Awaited<ReturnType<typeof opened>>, from: AlphaMode, to: AlphaMode) {
  triangle.material.transparent = to === 'blend'
  triangle.backend.refreshMaterials!(true, { surfaces: [triangle.material], from, to })
}

/** The page positions of `positions` (`SOURCE` by default) on a position grid of 2^`exponent`. */
const cutOn = (exponent: number, positions = SOURCE) =>
  decodeGeometryPage(
    encodeGeometryPage(
      Uint32Array.of(0, 1, 2),
      {
        POSITION: { itemSize: 3, array: Float32Array.from(positions) },
      },
      exponent,
    ).data,
  ).attributes.position

test('WebGL2 draws a primitive turned blended on the blended grid, and its own page once back', async () => {
  const triangle = await opened()
  const { backend, geometry, material, encoded } = triangle
  try {
    const own = [...decodeGeometryPage(encoded.data).attributes.position]
    assert.deepEqual(drawnPositions(triangle), own)
    move(triangle, 'opaque', 'blend')
    await backend.flush!()
    // A 0.6-wide primitive, blended: 2^23 steps of it, where the opaque grid is 2^-16.
    assert.deepEqual(drawnPositions(triangle), [...cutOn(-23)])
    assert.notDeepEqual([...cutOn(-23)], [...cutOn(-16)])
    move(triangle, 'blend', 'opaque')
    await backend.flush!()
    assert.deepEqual(drawnPositions(triangle), own, 'compiled opaque: the page it reads')
  } finally {
    backend.dispose()
    geometry.dispose()
    material.dispose()
  }
})

// A seam-locked solve (#877) writes coarse vertices past the source's, held by its pages alone.
test('WebGL2 re-cuts a solved primitive with the vertices only its pages hold', async () => {
  const triangle = triangleBackend({ corners: [0, 1, 3] })
  const { backend, geometry, material, paged } = triangle
  try {
    const array = Float32Array.of(...SOURCE.slice(0, 6), 0.1, 0.2, 0)
    const solved = encodeGeometryPage([0, 1, 2], { POSITION: { itemSize: 3, array } })
    paged.encoded.set('triangle-geometry.bin', solved)
    const page = paged.metadata.primitives[0].pages[0]
    page.level = 1
    page.geometry!.bytes = solved.data.length
    await backend.prepare()
    ;(geometry.getAttribute('position')!.array as Float32Array).set(SOURCE)
    const placed = decodeGeometryPage(solved.data).attributes.position.slice(6)
    move(triangle, 'opaque', 'blend')
    await backend.flush!()
    const expected = cutOn(-23, [...SOURCE.slice(0, 6), ...placed])
    assert.deepEqual(drawnPositions(triangle), [...expected], 'the placed vertex read in its page')
  } finally {
    backend.dispose()
    geometry.dispose()
    material.dispose()
  }
})

test('WebGL2 refuses by name a move whose pages carry a second texture coordinate', async () => {
  const triangle = await opened()
  const { backend, geometry, material, paged } = triangle
  try {
    paged.metadata.primitives[0].pages[0].geometry!.flags |= 4
    const alpha = { surfaces: [material], from: 'opaque', to: 'blend' } as const
    assert.match(backend.materialClassRefusal!(alpha) ?? '', /second texture coordinate/)
    const back = { ...alpha, surfaces: [new G.GraphSurface('basic')] }
    assert.equal(backend.materialClassRefusal!(back), undefined, 'a surface nothing wears')
  } finally {
    backend.dispose()
    geometry.dispose()
    material.dispose()
  }
})

test('WebGL2 keeps the page the host replaced through a class change and back (#837)', async () => {
  const triangle = await opened()
  const { backend, geometry, material, encoded } = triangle
  try {
    const host = decodeGeometryPage(encoded.data)
    host.attributes.position[0] = -0.25
    backend.replaceGeometryPage!('triangle-geometry.bin', host)
    move(triangle, 'opaque', 'blend')
    await backend.flush!()
    assert.deepEqual(drawnPositions(triangle), [...host.attributes.position], 'not the recut')
    move(triangle, 'blend', 'opaque')
    await backend.flush!()
    assert.deepEqual(drawnPositions(triangle), [...host.attributes.position], 'not the cache')
  } finally {
    backend.dispose()
    geometry.dispose()
    material.dispose()
  }
})

// The compiler sets an opaque primitive's tile by the largest scale any placement gives it
// (`mesh_scales`): a move of one mesh alone cuts on the tile its unmoved twin sets too, never on
// a coarser one.
test('WebGL2 cuts a partial assignment on the tile of every placement, as the compiler', async () => {
  const triangle = await opened({ pass: 'clustered-blend', twinScale: 1024 })
  const { backend, geometry, material, mesh } = triangle
  const opaque = G.basicSurface({ side: G.DOUBLE_SIDE })
  try {
    material.transparent = true
    const assignment = { surfaces: [opaque], meshes: new Map([[mesh, opaque]]) } as const
    backend.wearSurface!({ ...assignment, from: 'blend', to: 'opaque' })
    backend.refreshMaterials!(true, { ...assignment, from: 'blend', to: 'opaque' })
    await backend.flush!()
    const compiled = await positionGridExponent(0.6, false, { finestError: 0, scale: 1024 })
    const alone = await positionGridExponent(0.6, false, { finestError: 0, scale: 1 })
    assert.notEqual(compiled, alone, 'the twin sets a finer tile than the moved mesh')
    assert.ok(
      drawnMeshes(triangle).some((drawn) => drawn.join() === [...cutOn(compiled!)].join()),
      'the moved mesh draws the page the compiler cuts for its largest placement',
    )
  } finally {
    opaque.dispose()
    backend.dispose()
    geometry.dispose()
    material.dispose()
  }
})
