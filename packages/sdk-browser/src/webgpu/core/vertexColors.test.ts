// WebGPU drew white where a material asks for vertex colours. The colours of the geometry
// read as floats ride at the tail of the UV buffer; these tests read that buffer as uploaded
// and index it the way the shader's `vertColor` does.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import { Scene } from '../../world/core/scene.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { written, type FakeWrite } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { prepareWebgpuGeometry } from './geometryPrepare.ts'
import { VERTEX_COLOR_WGSL } from './vertexColors.ts'
import type { PageRec } from '../../page/selection/types.ts'
import type { GeometryBlock } from '../row/pageRowMaterial.ts'
import type { HostAttributes } from '../../host/resources.ts'
import { surfaceOf } from '../../page/surface.ts'
import { FLAG_HAS_COLOR } from '../../visibility/types.ts'
import { prepareWebgpuBlend } from '../blend/prepare.ts'
import { createWebgpuBlendState } from '../blend/state.ts'
import { createMaterialTable } from '../material/materialTable.ts'
import { rowFlags } from '../row/surfaceRow.ts'
import { BLEND_SHADER } from '../../gpu/core/shaderTexts.fixture.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'

/** `vertColor(id)` of the shader, on the floats of a bound UV buffer. */
function vertColor(uvs: Float32Array, id: number) {
  const i = Math.floor(uvs.length / 6) * 2 + id * 4
  return Array.from(uvs.subarray(i, i + 4))
}

const floats = (write: FakeWrite) => new Float32Array(written(write).slice().buffer)

function triangleGeometry(colour?: number[], itemSize = 3, uv = true) {
  const geometry = new Geometry()
  geometry.setAttribute('position', G.floatAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  if (uv) geometry.setAttribute('uv', G.floatAttribute([0.25, 0.5, 1, 0, 0, 1], 2))
  if (colour) geometry.setAttribute('color', G.floatAttribute(colour, itemSize))
  geometry.setIndex(G.indices([0, 1, 2]))
  return geometry
}
const triangle = (colour?: number[], itemSize = 3, uv = true) =>
  triangleGeometry(colour, itemSize, uv).attributes as HostAttributes

test('the shader finds the colour tail from the buffer length, as the test mirror does', () => {
  assert.match(wgslSource(VERTEX_COLOR_WGSL), /let i=arrayLength\(&uvs\)\/6u\*2u\+id\*4u;/)
})

test('the source geometry of a scene carries its vertex colours at the tail of its UVs', () => {
  const { device, writes } = fakeDevice()
  const plain = triangle(),
    coloured = triangle([1, 0, 0, 0, 1, 0, 0, 0.5, 1])
  const pages = [{ attributes: plain }, { attributes: coloured }] as PageRec[]
  const blocks = new Map<HostAttributes, GeometryBlock>()
  prepareWebgpuGeometry(device, pages, blocks)
  const uvs = floats(writes[1])
  assert.equal(uvs.length, 6 * 6)
  assert.equal(blocks.get(plain)!.hasColor, false)
  const block = blocks.get(coloured)!
  assert.equal(block.hasColor, true)
  // A three-component colour reads an alpha of one; the UVs before the tail did not move.
  assert.deepEqual(vertColor(uvs, block.vertexBase), [1, 0, 0, 1])
  assert.deepEqual(vertColor(uvs, block.vertexBase + 2), [0, 0.5, 1, 1])
  assert.deepEqual(
    Array.from(uvs.subarray(block.vertexBase * 2, block.vertexBase * 2 + 2)),
    [0.25, 0.5],
  )
})

test('a scene without vertex colours uploads the UV buffer it always did', () => {
  const { device, writes } = fakeDevice()
  prepareWebgpuGeometry(device, [{ attributes: triangle() }] as PageRec[], new Map())
  assert.deepEqual(Array.from(floats(writes[1])), [0.25, 0.5, 1, 0, 0, 1])
})

test('a transparent item multiplies its colour by the vertex colour when its material asks', () => {
  const blendState = createWebgpuBlendState()
  const copy = (vertexColors: boolean, colour?: number[]) => {
    const material = G.standardSurface({ transparent: true, opacity: 0.5, vertexColors })
    const mesh = G.mesh(triangleGeometry(colour), material)
    return Object.assign(mesh, { surface: surfaceOf(material) })
  }
  const red = [1, 0, 0, 1, 0, 0, 1, 0, 0]
  const copies = [copy(true, red), copy(false, red), copy(true)]
  prepareWebgpuBlend(copies, blendState, new Scene())
  // An item's flags are its page row's, as its record writer derives them (`rowFlags`): the
  // material's ask over the colours its geometry carries.
  const tables = { mapLayer: new Map(), dataLayer: new Map(), materialTable: createMaterialTable() }
  const coloured = blendState.blendGpu.map((item) => {
    const { row } = tables.materialTable.surface(item.surface, tables)
    return (rowFlags(row, item.geometry, undefined).flags & FLAG_HAS_COLOR) !== 0
  })
  assert.deepEqual(coloured, [true, false, false])
  // The vertex stage multiplies the item colour, alpha included, at the vertex it fetched.
  const stage = BLEND_SHADER.slice(BLEND_SHADER.indexOf('@vertex fn vs'))
  const fetch = stage.indexOf('let v=corners[local%3u];')
  const multiply = stage.indexOf(
    `if((flags&${FLAG_HAS_COLOR}u)!=0u){out.color*=pageColor(page,h,v);}`,
  )
  assert.ok(fetch > 0 && multiply > fetch)
  // The colour it multiplies is `vertColor` (`VERTEX_COLOR_WGSL`), its whole body, declared once
  // in the module.
  assert.ok(BLEND_SHADER.includes(VERTEX_COLOR_WGSL.text))
  assert.equal(BLEND_SHADER.split('fn vertColor(').length, 2)
})
